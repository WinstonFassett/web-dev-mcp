# Spike: Persistent capnweb Sessions for MCP Clients

## The insight

capnweb protocol is JSON arrays. An LLM can construct them directly — no JS runtime needed. But references (import IDs) need to persist across MCP tool calls.

## How capnweb references work

```
Agent sends: ["push", ["import", 0, ["document", "querySelector"], ["h1"]]]
Server assigns import ID 1 → agent now holds a reference to the <h1> element

Agent sends: ["push", ["import", 1, ["textContent"]]]
Server assigns import ID 2 → reference to the text content

Agent sends: ["pull", 2]
Server responds: ["resolve", -2, "Hello World"]
```

Import IDs are the agent's "cursors" into the browser DOM. They persist for the life of the capnweb session.

## Current state

```
MCP SSE session (persistent, has sessionId)
  └── tool call: eval_capnweb
        └── creates AsyncFunction, runs it, returns result
            └── capnweb stubs used WITHIN the function only
                └── references die when function returns
```

Each `eval_capnweb` call is stateless. Agent can't say "remember that element I found — click it."

## Proposed: per-MCP-session capnweb session

```
MCP SSE session (persistent, sessionId: "abc123")
  └── capnweb session (created on first capnweb tool call)
        └── import table: { 0: gateway, 1: document, 3: <h1>, ... }

  Tool call 1: capnweb_push ["import", 0, ["document", "querySelector"], ["h1"]]
    → import ID 3 assigned, persists

  Tool call 2: capnweb_push ["import", 3, ["textContent"]]
    → import ID 4 assigned

  Tool call 3: capnweb_pull 4
    → "Hello World"

  Tool call 4: capnweb_push ["import", 3, ["click"]]
    → clicks the same h1 from tool call 1
```

References survive across tool calls because the capnweb session lives as long as the MCP session.

## Implementation

### Gateway side

```
connections map (existing):
  sessionId → { transport, server }

New: capnwebSessions map:
  sessionId → {
    session: RpcSession,     // capnweb session to browser
    gateway: GatewayApi,     // the main stub
    importCounter: number,   // next import ID
  }
```

Created lazily on first capnweb tool call. Destroyed when MCP session disconnects (`transport.onclose`).

### MCP tools

**Option A: Raw protocol messages**

```
capnweb_send({ messages: [["push", ["import", 0, ["document"]]], ["pull", 1]] })
→ { results: [{ import_id: 1 }, { resolved: { ... } }] }
```

Agent constructs protocol messages directly. Most powerful, most complex.

**Option B: High-level with persistent references**

```
capnweb_call({ target: 0, method: "querySelector", args: ["h1"] })
→ { ref: 3, type: "element" }

capnweb_get({ ref: 3, property: "textContent" })
→ { value: "Hello World" }

capnweb_call({ target: 3, method: "click" })
→ { result: undefined }

capnweb_release({ ref: 3 })
```

Simpler API, agent thinks in terms of refs. Gateway translates to protocol.

**Option C: Both**

`eval_capnweb` for quick one-shots (existing). `capnweb_call`/`capnweb_get` for stateful multi-step. Raw protocol for power users.

## Browser reconnection

When browser page reloads:
1. Browser RPC session dies
2. New browser connects, new capnweb session
3. All old import IDs are invalid

Gateway detects browser disconnect → marks all agent capnweb sessions as stale. Next tool call returns error: `{ error: "browser_reconnected", message: "Browser reloaded. References invalidated. Re-query needed." }`

Agent re-queries from `document` (import 0 is always valid after reconnect since GatewayApi re-fetches the stub).

## What this enables

An agent can:
1. Find an element → get a ref
2. Do something else (edit code, wait for HMR)
3. Come back to that same ref and check if it changed
4. Traverse from it to find nearby elements
5. All without re-querying from scratch

It's a stateful DOM cursor that persists across the agent's conversation turns.

## Questions

- Should `eval_capnweb` also use the persistent session? (Currently it's stateless — each call gets fresh stubs)
- How much of the raw protocol should we expose vs abstract?
- Do we need ref garbage collection / TTL?
- Can an agent reasonably construct capnweb protocol messages, or is the high-level API (Option B) more practical?
