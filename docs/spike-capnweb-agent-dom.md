# Spike: capnweb Agent → Browser DOM Access

## Problem

21 MCP tools is too many. Agent has to reason about which tool to use. Most are thin wrappers around DOM operations that could just be... DOM operations.

`eval_in_browser` is blocked by CSP on real sites. `click` requires knowing a CSS selector. No way to chain: "find text X, then find next link near it."

## Insight

capnweb already gives us:
- **Object-capability passing** — browser's `document` is a remote reference, not a copy
- **Promise pipelining** — chained calls without await = single round trip
- **Bidirectional** — either side can call methods on the other
- **CSP-safe** — method calls on existing objects, not eval

The browser already exposes `document` and `window` as `AnyTarget` over RPC. The gateway already holds a stub to these. We just need to hand that stub to agent clients.

## Proposal

### New endpoint: `/__rpc/agent`

Agent connects via WebSocket + capnweb. Gateway returns a `GatewayApi`:

```js
class GatewayApi extends RpcTarget {
  get document() { return getBrowserStub().document }
  get window()   { return getBrowserStub().window }
  get browsers()  { /* list connected browsers */ }
}
```

### Agent usage (with capnweb client)

```js
import { newWebSocketRpcSession } from 'capnweb'

const session = newWebSocketRpcSession(ws, {})
const gw = session.getRemoteMain()

// Promise pipelining — these don't await individually
const doc = gw.document
const link = doc.querySelector('a.story-link')
const href = await link.href           // ONE round trip for the whole chain

// DOM traversal — find "DOOM Over DNS" comments
const title = doc.querySelector('.titleline a')
const subRow = title.closest('tr').nextElementSibling
const comments = subRow.querySelector('a:last-child')
await comments.click()                 // pipelined, then click
```

### What this replaces

| MCP tool | capnweb equivalent |
|---|---|
| `eval_in_browser(expr)` | Just call methods directly (CSP-safe) |
| `click(selector)` | `doc.querySelector(sel).click()` |
| `fill(selector, val)` | `doc.querySelector(sel).value = val` |
| `get_visible_text(sel)` | `doc.querySelector(sel).innerText` |
| `query_dom(sel)` | `doc.querySelector(sel).innerHTML` |
| `screenshot()` | Keep as MCP tool (needs html2canvas) |
| `navigate(url)` | `gw.window.location.href = url` |
| `get_page_markdown()` | Keep as MCP tool (complex DOM walk) |

### What MCP tools remain useful for

- `get_diagnostics` — reads NDJSON log files, not browser DOM
- `get_page_markdown` — complex DOM→markdown conversion, better as server-side
- `screenshot` — needs html2canvas lazy-loading
- `clear_logs` / `get_session_info` — server state, not browser
- `get_build_status` / `wait_for_condition` — polling patterns

So MCP becomes ~6-8 high-level tools for observability. capnweb handles all direct browser interaction.

## What to verify in spike

1. **Does pipelining work across two hops?** Agent → Gateway → Browser. Does capnweb pipeline through the gateway proxy, or does each hop serialize?

2. **AnyTarget coverage** — does `closest()`, `querySelectorAll()`, iteration over NodeList, setting `.value` all work through the proxy?

3. **Error handling** — what happens when querySelector returns null and you chain off it?

4. **Latency** — measure round trip for a pipelined 5-call chain vs 5 individual MCP tool calls

5. **Can Claude Code use capnweb directly?** — could an MCP tool return a capnweb connection URL, and Claude's agent SDK connect to it? Or does the agent need a dedicated script?

## Steps

1. Add `/__rpc/agent` endpoint to gateway (differentiate from browser connections by query param or path)
2. Create `GatewayApi` RpcTarget that proxies to browser stub
3. Write test script that connects as agent, chains DOM calls on live HN page
4. Measure pipelining behavior (are intermediate calls batched?)
5. Test error cases (null element, disconnected browser)
6. If it works: slim down MCP tools to observability-only, document capnweb patterns
