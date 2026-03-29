---
name: web-dev-mcp-storybook
description: Storybook-specific patterns for web-dev-mcp. Use when working with Storybook components — navigating stories, TDD per-component, visual testing across variants, interacting with rendered components in the preview iframe.
---

# web-dev-mcp-storybook

Extends web-dev-mcp with Storybook-specific workflows. Requires the `web-dev-mcp` skill for core tools (`eval_js_rpc`, `get_diagnostics`, `clear`, etc.).

## Detecting Storybook

When `list_projects` returns a server with `type: "storybook"`, these patterns apply. The MCP tools operate on the **preview iframe** (`/iframe.html`), not the Storybook manager shell.

## Storybook globals (via browser.eval)

Storybook injects useful globals into the preview iframe, accessible via `browser.eval`:

| Global | What it gives you |
|--------|-------------------|
| `__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries` | All stories: IDs, names, titles, file paths |
| `__STORYBOOK_PREVIEW__.currentSelection` | Current story ID and viewMode |
| `__STORYBOOK_ADDONS_CHANNEL__` | Channel for SPA-style story navigation (no RPC disconnect) |

**List all stories:**
```js
return await browser.eval(
  "JSON.stringify(Object.values(window.__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries).map(e => ({id: e.id, name: e.name, title: e.title, file: e.componentPath})))"
)
// → [{id: "components-button--primary", name: "Primary", title: "Components/Button", file: "./src/Button.tsx"}, ...]
```

**Get current story:**
```js
return await browser.eval("JSON.stringify(window.__STORYBOOK_PREVIEW__.currentSelection)")
// → {viewMode: "story", storyId: "components-button--primary"}
```

## Navigate to a story

Use the Storybook channel to navigate — it's SPA-style, RPC stays connected, no wait needed:

```js
await browser.eval("window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: 'components-button--danger' })")
// wait ~200ms for render, then read
await new Promise(r => setTimeout(r, 200))
return await browser.markdown()
```

URL-based navigation (`browser.navigate` to `iframe.html?id=...`) does **not** change the story — the manager frame controls story selection, not the iframe URL.

## Story URL pattern

Story IDs are derived from title/name, lowercased and kebab-cased:
- `Components / Button` + story `Primary` → `components-button--primary`
- `Forms / Input` + story `With Validation` → `forms-input--with-validation`

## TDD in Storybook

Storybook gives you per-component isolation. The test-fix loop is the same as web-dev-mcp but scoped to a single component:

```
clear
# edit component source — HMR reloads the story automatically
get_diagnostics({ since_checkpoint: true })
# check for errors in this component only (no app-wide noise)
eval_js_rpc: return await browser.screenshot()
# verify the component visually
```

This is especially powerful because:
- Console errors are **per-component**, not whole-app noise
- HMR is fast — only the story re-renders
- Each story is a test case with specific props/args

## Visual testing across variants

Screenshot each story variant after a change — uses channel navigation so no RPC disconnect between stories:

```js
const entries = JSON.parse(await browser.eval(
  "JSON.stringify(Object.keys(window.__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries))"
))
const results = []
for (const storyId of entries) {
  await browser.eval(`window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: '${storyId}' })`)
  // small delay for render
  await new Promise(r => setTimeout(r, 500))
  const screenshot = await browser.screenshot()
  results.push({ storyId, screenshot })
}
return results.map(r => r.storyId)
```

## Read component content

```js
// Markdown representation of what's rendered
return await browser.markdown()
// → "<button[submit]: Primary Button>"

// Raw text content
return await document.querySelector('#storybook-root').innerText

// HTML structure
return await document.querySelector('#storybook-root').innerHTML
```

## Interact with rendered component

```js
// Click a button in the story
await browser.click('text=Submit')
return await browser.screenshot()

// Fill an input in the story
await browser.fill('input[name="email"]', 'test@example.com')

// Wait for async behavior
await browser.click('text=Load')
await browser.waitFor('.loading-complete', 100, 5000)
return await browser.screenshot()
```

## Storybook args (controls)

Stories render with specific args (props). Args can be updated via the channel:
```js
// TODO: verify channel event for updating args programmatically
```

## Setup

In `.storybook/main.ts`:

```ts
export default {
  addons: ['web-dev-mcp-gateway/storybook'],
  framework: '@storybook/react-vite',
}
```

Start gateway + storybook:
```bash
npx web-dev-mcp-gateway          # terminal 1
npm run storybook                 # terminal 2
```

## Accessing the manager shell

MCP tools operate on the **preview iframe** by default — `document.querySelector` hits the component. But the manager is same-origin and accessible via `window.parent`:

```js
// Read the manager's page title
return await browser.eval("window.parent.document.title")

// Read the sidebar
return await browser.eval("window.parent.document.querySelector('#storybook-explorer-tree')?.innerText")
```

This means you have full access to both frames from a single injection point.

## Gotchas

- `document.*` hits the **preview iframe** (component DOM). Use `window.parent.document.*` for the manager shell (sidebar, controls, search).
- Use channel `emit('setCurrentStory')` for story navigation. URL-based navigation (`browser.navigate` to `iframe.html?id=...`) does not change the story — the manager frame controls story selection.
- Storybook is fully SPA — RPC never disconnects during normal use (story changes, HMR reloads).
- Storybook also ships its own MCP server (component docs, stories, props). Ours is complementary — we add live browser observability (console, screenshots, DOM interaction, JS eval).
- `#storybook-root` is the root element where stories render inside the preview iframe.
