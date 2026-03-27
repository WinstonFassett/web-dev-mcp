---
name: web-dev-mcp
description: Live browser observability and control for frontend development. Use when testing UI changes, debugging console errors, checking HMR status, taking screenshots, clicking elements, filling forms, or reading page content during local development.
---

# web-dev-mcp

MCP tools for live browser interaction during frontend development. Connected via SSE at `/__mcp/sse`.

## Core workflow (test-fix loop)

```
clear_logs                                    # reset checkpoint
(make code change — HMR reloads automatically)
get_diagnostics({ since_checkpoint: true })    # errors? warnings? only new events
screenshot({ selector: '#my-component' })      # visual check
```

## Reading the page

- `query_dom({ selector, max_depth })` — HTML snapshot. See structure, classes, IDs. **Best for dev.**
- `get_visible_text(selector)` — plain rendered text
- `get_page_markdown(selector)` — markdown with `[link text](url)`. Best for content/link discovery.
- `screenshot(selector)` — visual PNG

All accept an optional `selector` to scope to an element.

## Interacting

All selectors support CSS or `text=` prefix for text matching:

- `click("text=Submit")` — click by visible text
- `click("#save-btn")` — click by CSS selector
- `fill("#email", "test@example.com")` — fill input
- `hover("text=Menu")` — hover by text
- `navigate(url)` — go to URL
- `press_key("Enter")` — keyboard input

## Observing

- `get_diagnostics` — console + errors + network + HMR in one call. Use `since_checkpoint: true` after `clear_logs`.
- `get_hmr_status` — lightweight poll for HMR state
- `get_logs({ channel, search, level })` — granular log queries

## Gotchas

- `eval_in_browser` uses `new Function()` — may be blocked by CSP. Prefer `query_dom` or `get_visible_text`.
- After `navigate()`, browser reconnects RPC. Wait a moment before next tool call.
- For complex DOM traversal, see [RECIPES.md](RECIPES.md) for capnweb patterns.
