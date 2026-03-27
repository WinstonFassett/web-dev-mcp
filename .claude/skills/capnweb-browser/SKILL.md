---
name: capnweb-browser
description: Direct capnweb RPC access to browser DOM. Use when connecting to browser directly via WebSocket or HTTP, holding element references across calls, working with capnweb import IDs, or needing persistent browser sessions beyond what MCP tools provide.
---

# capnweb Browser Access

Direct RPC to the browser via [capnweb](https://blog.cloudflare.com/capnweb-javascript-rpc-library/). For most dev tasks, use the `web-dev-mcp` skill instead — this is for agents that need lower-level access.

## Two transports, different tradeoffs

### WebSocket (`/__rpc/agent`)

Persistent session. References (import IDs) survive across messages.

```js
import { connect } from 'web-dev-mcp-gateway/agent'

const browser = await connect('ws://localhost:3333/__rpc/agent')
const { document } = browser

// Get a reference — this is a capnweb import ID under the hood
const heading = document.querySelector('h1')

// Use it now
const text = await heading.textContent  // "Hello"

// ... time passes, agent does other work ...

// Use the SAME reference later — still alive because WebSocket is open
await heading.click()  // works

// Promise pipelining: chain without individual awaits = batched round trips
const href = document.querySelector('a').closest('tr').nextElementSibling.querySelector('a:last-child').href
console.log(await href)  // one network round trip for the whole chain

browser.close()  // all refs die
```

**Refs die when:** WebSocket closes, browser page reloads, gateway restarts.

### HTTP batch (`/__rpc/batch`)

Stateless per request. All calls in one HTTP round-trip. Refs exist within the batch but die when the response completes.

```js
import { newHttpBatchRpcSession } from 'capnweb'

const gw = newHttpBatchRpcSession('http://localhost:3333/__rpc/batch')
const title = await gw.document.title          // one HTTP POST, done
const md = await gw.getPageMarkdown()           // another POST, independent
```

Each call to `newHttpBatchRpcSession` creates a fresh session. No WebSocket. No persistent state. Good for one-shot operations, CI bots, scripts.

Raw protocol via curl (newline-separated messages):

```bash
# One-shot: read document.title
curl -X POST http://localhost:3333/__rpc/batch \
  -d '["stream",["import",0,["document","title"]]]'
# → ["resolve",1,"My Page Title"]

# Pipelined: querySelector then read tagName (one round-trip)
curl -X POST http://localhost:3333/__rpc/batch \
  -d '["push",["import",0,["document","querySelector"],["body"]]]
["stream",["import",1,["tagName"]]]'
# → ["resolve",2,"BODY"]
```

**Refs die when:** HTTP response completes.

## What a ref actually is

A capnweb import ID. When you call `document.querySelector('h1')`, the browser creates an export (negative ID) pointing to the real DOM element. Your side gets an import (positive ID) — a handle to that remote object. Method calls and property reads on the handle are RPC calls to the browser.

Import IDs are scoped to the capnweb session. WebSocket session = persistent IDs. HTTP batch = IDs live for one request.

## What eval_js_rpc does internally

The `eval_js_rpc` MCP tool runs your JS code on the server. `document` and `window` in that code are capnweb stubs from the gateway's persistent WebSocket to the browser.

A `state` object persists across calls within the same MCP session. Store capnweb proxy refs there to hold them: `state.store = window.__REDUX_STORE__`. The proxy stays alive because the gateway's WebSocket session stays alive. Use this for JS runtime objects (stores, globals) that survive HMR.

DOM element refs in `state` will go stale after page reload — re-query those by selector.

## Browser reconnection

When the browser page reloads (navigation, HMR full reload):
1. Browser's RPC WebSocket disconnects
2. All import IDs from that session are invalid
3. Browser reconnects with a new session
4. Agent must re-query from `document` — old refs point to nothing

This affects both transports. A held ref to `<h1>` is meaningless after the page reloads — the element literally doesn't exist anymore.

## When to use what

| Scenario | Transport |
|---|---|
| Quick read/click from MCP tool | `eval_js_rpc` (MCP) |
| Multi-step DOM exploration with held refs | WebSocket (`/__rpc/agent`) |
| CI/CD automation, one-shot queries | HTTP batch (`/__rpc/batch`) |
| Custom agent scripts | WebSocket via `connect()` helper |
| Admin dashboard | WebSocket + polling |

## Protocol overview

Full spec: https://github.com/cloudflare/capnweb/blob/main/protocol.md

Messages are JSON arrays. Key message types:

| Message | Purpose |
|---|---|
| `["push", expr]` | Call a method or read a property. Returns an import ID. |
| `["pull", importId]` | Request the resolved value of an import. |
| `["resolve", exportId, expr]` | Server returns a result. |
| `["reject", exportId, expr]` | Server returns an error. |
| `["release", importId, refcount]` | Client frees a reference. |
| `["stream", expr]` | One-shot: push + auto-pull + release. |

Expressions reference remote objects:
- `["import", 0]` — the main API object (import ID 0)
- `["import", 0, ["document", "querySelector"], ["h1"]]` — call `api.document.querySelector("h1")`
- `["import", 3, ["textContent"]]` — read property on import ID 3

Promise pipelining: you can reference an import ID before it resolves. The server queues the call. Multiple `push` messages in one batch execute sequentially server-side — one network round-trip for the whole chain.

Values are JSON with type wrappers: `["date", ms]`, `["error", type, msg, stack?]`, `["bytes", base64]`, `["undefined"]`. `RpcTarget` instances are passed by reference (as export/import IDs), not by value.

## Agent client helper

```js
import { connect } from 'web-dev-mcp-gateway/agent'

const browser = await connect('ws://localhost:3333/__rpc/agent')

// Remote DOM
browser.document    // capnweb proxy to browser's document
browser.window      // capnweb proxy to browser's window

// Convenience methods (call browser-side functions)
browser.navigate(url)
browser.getPageMarkdown(selector?)
browser.getVisibleText(selector?)
browser.screenshot(selector?)
browser.click(selector)
browser.fill(selector, value)
browser.getBrowserCount()
browser.close()
```
