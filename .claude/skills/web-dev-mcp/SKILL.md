---
name: web-dev-mcp
description: Interact with live browsers via MCP tools or capnweb remote DOM. Use when testing UI, debugging frontend, reading page content, clicking elements, filling forms, or navigating web apps during development.
---

# web-dev-mcp

Live browser observability and interaction for AI agents. Two interfaces:

## 1. MCP Tools (high-level)

Connect via SSE at `/__mcp/sse`. Best for: diagnostics, screenshots, page reading.

**Start here:**
- `get_page_markdown` — page as markdown with `[link text](url)`. Best way to read a page.
- `get_diagnostics` — console logs + errors + HMR status in one call
- `screenshot` — full page or element PNG

**Interact:**
- `click(selector)` / `fill(selector, value)` / `navigate(url)`
- `query_dom(selector)` — HTML snapshot with configurable depth

**Observe:**
- `clear_logs` then `get_diagnostics(since_checkpoint: true)` — see only new events after a code change

## 2. capnweb Agent Client (live remote DOM)

Connect via WebSocket at `/__rpc/agent`. Best for: DOM traversal, chaining, CSP-blocked sites.

```js
import { connect } from 'web-dev-mcp-gateway/agent'

const browser = await connect('ws://localhost:3333/__rpc/agent')
const { document } = browser

// Chain DOM calls — pipelined into minimal round trips
const title = await document.querySelector('h1').textContent
const link = document.querySelector('a.nav').closest('li').nextElementSibling.querySelector('a')
const href = await link.href
await link.click()

// After navigation, reconnect (page reload breaks RPC)
browser.close()
const page2 = await connect('ws://localhost:3333/__rpc/agent')
```

No eval. No CSP issues. Full DOM API via remote proxies.

## Recipes

See [RECIPES.md](RECIPES.md) for common patterns.

## Gotchas

- `eval_in_browser` uses `new Function()` — blocked by CSP on many sites. Use `get_page_markdown` or capnweb instead.
- After `navigate()`, browser reconnects RPC. Agent must reconnect too (new `connect()` call).
- `click(selector)` needs a CSS selector. If you only have text, use `get_page_markdown` to find the element's context, then construct a selector.
