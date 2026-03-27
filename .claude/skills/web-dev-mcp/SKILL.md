---
name: web-dev-mcp
description: Live browser observability and control for frontend development. Use when testing UI changes, debugging console errors, checking HMR status, taking screenshots, clicking elements, filling forms, or reading page content during local development.
---

# web-dev-mcp

Controls an already-open browser tab during development. MCP server at `/__mcp/sse`.

## Core tools

### `get_diagnostics`

Server-side. Reads NDJSON log files + HMR/build status. One call for everything.

```
get_diagnostics({ since_checkpoint: true })  # only events since last clear
get_diagnostics({ level: "error" })          # filter by level
get_diagnostics({ search: "TypeError" })     # text search
```

### `clear`

Resets logs and/or capnweb session state. Call before a code change to get clean reads.

```
clear({ logs: true })                        # truncate log files, set checkpoint
clear({ state: true })                       # clear capnweb persistent refs
clear({ logs: true, state: true })           # both
```

### `eval_capnweb`

Runs JavaScript on the server with `document` and `window` as live capnweb remote proxies to the browser. Each DOM call is an RPC round-trip. CSP-safe, multi-statement, supports await.

**Globals available in code:**

| Name | What it is |
|---|---|
| `document` | Remote DOM proxy. querySelector, textContent, click, etc. |
| `window` | Remote window proxy. location, localStorage, etc. |
| `state` | Persistent object — survives across calls. Store element refs here. |
| `browser.markdown(selector?)` | Element/page to markdown with `[links](urls)` |
| `browser.screenshot(selector?)` | PNG screenshot |
| `browser.navigate(url)` | Change page (disconnects RPC, wait before next call) |
| `browser.click(selector)` | Click. Supports `text=` prefix for text matching. |
| `browser.fill(selector, value)` | Fill input. Supports `text=` prefix. |
| `browser.waitFor(fnOrSelector, interval?, timeout?)` | Poll until element exists or function returns truthy |

## Workflow: test-fix loop

```
clear({ logs: true })
# make code change — HMR reloads
get_diagnostics({ since_checkpoint: true })
# check errors, then visual:
eval_capnweb: return await browser.screenshot()
```

## Examples

**Read page content:**
```js
// as markdown (links, headings, form elements)
return await browser.markdown('#main-content')

// as plain text
return await document.querySelector('#main-content').innerText

// as HTML structure
return await document.querySelector('#main-content').innerHTML
```

**Click by text:**
```js
await browser.click('text=Submit')
```

**Fill a form:**
```js
await browser.fill('#email', 'test@example.com')
await browser.fill('#password', 'secret')
await browser.click('text=Sign In')
```

**Store a ref, use it later:**
```js
// Call 1
state.form = document.querySelector('form#signup')
return await state.form.innerHTML

// Call 2 (same MCP session — state persists)
await browser.fill('#email', 'new@example.com')
return await state.form.querySelector('.error').textContent
```

**Wait for async UI:**
```js
await browser.click('text=Load Data')
const toast = await browser.waitFor('.success-toast', 100, 5000)
return await toast.textContent
```

**DOM traversal chain:**
```js
const link = document.querySelector('a[href*="doom"]')
const row = link.closest('tr').nextElementSibling
const href = await row.querySelector('a:last-child').href
return href
```

## Gotchas

- `browser.navigate()` disconnects RPC — wait ~2-3s before next call. For SPA route changes, prefer `browser.click('text=Settings')` on a nav element.
- `state` refs die on browser page reload. Re-query from `document`.
- `browser.screenshot()` returns JSON with base64 data, not MCP image content type.

See [RECIPES.md](RECIPES.md) for more patterns.
