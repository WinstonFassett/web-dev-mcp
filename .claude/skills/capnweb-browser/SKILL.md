---
name: capnweb-browser
description: "[DEPRECATED] capnweb RPC was removed from the gateway. Use eval_js MCP tool or the web-dev-mcp skill instead. This skill is retained for reference only."
---

# capnweb Browser Access (Deprecated)

capnweb RPC has been removed from the gateway core. The `/__rpc/agent` WebSocket endpoint and `/__rpc/batch` HTTP endpoint no longer exist. The `connect()` agent client library has been removed.

## What replaced it

All browser interaction now goes through:

1. **`eval_js` MCP tool** — runs JavaScript directly in the browser with `document`, `window`, `state`, and `browser.*` helpers available.
2. **Individual MCP tools** (`click`, `fill`, `screenshot`, etc.) — for agents that prefer discrete commands.
3. **JSON command WebSocket** (`/__rpc`) — internal protocol between gateway and browser. Not intended for direct agent use.

## Migration

| Before (capnweb) | After |
|---|---|
| `eval_js_rpc: return await document.querySelector('h1').textContent` | `eval_js: return document.querySelector('h1').textContent` |
| `state.store = window.__REDUX_STORE__; return await state.store.getState()` | `state.store = window.__REDUX_STORE__; return JSON.stringify(state.store.getState())` |
| `connect('ws://localhost:3333/__rpc/agent')` | Use MCP tools instead |
| `newHttpBatchRpcSession('http://localhost:3333/__rpc/batch')` | Use MCP tools instead |

Key difference: `document` and `window` are now real browser objects, not remote proxies. No `await` needed for property reads. Results that are objects must be explicitly serialized (`JSON.stringify`).

See the `web-dev-mcp` skill for current usage.
