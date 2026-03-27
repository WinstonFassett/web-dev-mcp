---
name: web-dev-mcp
description: Live browser observability and control for frontend development. Use when testing UI changes, debugging console errors, checking HMR status, taking screenshots, clicking elements, filling forms, or reading page content during local development.
---

# web-dev-mcp

MCP tools for live browser interaction. Connected via SSE at `/__mcp/sse`.

**This controls an already-open browser tab** — your dev app running in the browser. It is not a headless browser launcher. The browser must be open with the instrumented page loaded.

## Core workflow (test-fix loop)

```
clear_logs                                    # reset checkpoint
(make code change — HMR reloads)
get_diagnostics({ since_checkpoint: true })    # only new events since clear
screenshot({ selector: '#component' })         # visual check
```

## Reading the page — pick the right tool

**`query_dom(selector, max_depth)`** — HTML snapshot with structure, classes, IDs, attributes.
- Shows raw DOM including hidden elements (does NOT check computed styles)
- Configurable depth and attribute filtering
- Returns: HTML string. Can be large.
- **Use for:** checking component structure, finding selectors, seeing what rendered

**`get_visible_text(selector)`** — `innerText` of the element.
- Only text the user would see (respects `display:none`, `visibility:hidden`)
- Includes text outside the viewport (scrolled away)
- Returns: plain string. Lightweight.
- **Use for:** quick content check, verifying text rendered correctly

**`get_page_markdown(selector)`** — DOM converted to markdown with links, headings, form elements.
- Checks `getComputedStyle` on every element — skips hidden elements. **Most expensive.**
- Links become `[text](url)`, inputs become `<input placeholder="...">`, etc.
- Returns: markdown string. 30KB max.
- **Use for:** understanding page content, finding links to follow, reading articles

**`screenshot(selector)`** — visual PNG via html2canvas.
- Lazy-loads html2canvas from CDN on first use
- Returns: base64 PNG image
- **Use for:** visual verification, catching CSS/layout issues text tools miss

**`eval_in_browser(expression)`** — run JS expression, return result.
- Uses `new Function()` — may be blocked by CSP on non-local sites
- Returns: serialized result string
- **Use for:** quick checks like `document.title`, custom queries. Fastest single-value read.

All reading tools accept an optional `selector` to scope to an element.

## Interacting

Selectors support CSS or `text=` prefix for text matching:

```
click("text=Submit")           # by visible text
click("#save-btn")             # by CSS selector
fill("#email", "test@test.com")
hover("text=Menu")
press_key("Enter")
```

### Navigation

`navigate(url)` changes `window.location.href`. **This disconnects the RPC session** — the page unloads and the new page must reconnect. Wait a few seconds before the next tool call.

For single-page app route changes (React Router, Next.js links), prefer `click("text=Settings")` on a navigation element instead — SPA routing doesn't reload the page, so the connection stays alive.

If you need to drive browsing across full page loads without worrying about reconnection, use capnweb directly (see [RECIPES.md](RECIPES.md)) — it can open new windows and reconnect programmatically.

## Observing

- `get_diagnostics` — console + errors + network + HMR in one call. `since_checkpoint: true` after `clear_logs` for clean reads.
- `get_hmr_status` — lightweight HMR poll (update count, error count, pending state)
- `get_logs({ channel, search, level, limit })` — granular log queries with filtering

## Gotchas

- `eval_in_browser` blocked by CSP on some sites — use `get_visible_text` or `query_dom` instead
- `query_dom` includes hidden elements — use `get_visible_text` or `get_page_markdown` for visible-only content
- MCP tools are for simple actions on an existing tab. For complex multi-page flows or DOM traversal chains, see capnweb in [RECIPES.md](RECIPES.md).

See [RECIPES.md](RECIPES.md) for common patterns.
