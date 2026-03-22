# Architecture

## System Overview

```mermaid
graph TB
    subgraph Browser["Browser (client shim)"]
        CP[Console Patch<br/>log/warn/error/info/debug]
        EH[Error Handlers<br/>error, unhandledrejection]
        NP[Network Patch<br/>fetch/XHR, opt-in]
        HMR_H[HMR Relay Handlers<br/>eval, query-dom, react-tree<br/>fallback path]
        RPC_B[capnweb BrowserApi<br/>document · window · localStorage<br/>sessionStorage · eval · queryDom]
        ANY_T[AnyTarget proxy<br/>full DOM/Storage/Window API<br/>dynamic method forwarding]
        RA[React Adapter<br/>bippy instrument, opt-in]
    end

    subgraph Server["Vite Dev Server (single process)"]
        PLG[Plugin<br/>configureServer · hotUpdate<br/>resolveId · load · transform]
        MCP[MCP Server<br/>/__mcp/sse<br/>SSEServerTransport per connection]
        RPC_S[capnweb RPC Server<br/>/__rpc WebSocket<br/>RpcSession per browser tab]
        WR[Writers<br/>console · hmr · errors · network]
        LR[Log Reader<br/>NDJSON parse + filter + paginate]
        AR[Auto Register<br/>.mcp.json · .cursor · .windsurf]
        SESS[Session Manager<br/>hash · log dir · session.json]
    end

    subgraph Disk["Filesystem"]
        FILES["/tmp/vite-harness-{hash}/<br/>session.json<br/>console.ndjson<br/>hmr.ndjson<br/>errors.ndjson<br/>network.ndjson<br/>react.ndjson"]
    end

    subgraph Agent["AI Agent (Claude Code / Cursor / Windsurf)"]
        TOOLS[MCP Tools<br/>get_session_info · get_hmr_status<br/>get_logs · clear_logs<br/>eval_in_browser · query_dom<br/>get_react_tree]
        SHELL[Shell Tools<br/>grep · tail · cat on NDJSON files]
    end

    CP -->|harness:console| WR
    EH -->|harness:error| WR
    NP -->|harness:network| WR
    WR --> FILES
    LR --> FILES
    SESS --> FILES

    RPC_B <-->|"capnweb WebSocket (/__rpc)"| RPC_S
    ANY_T -.->|proxy stubs| RPC_B
    HMR_H <-->|"HMR WebSocket (import.meta.hot)"| PLG

    TOOLS <-->|"SSE + POST (/__mcp/sse)"| MCP
    MCP --> RPC_S
    MCP --> LR
    MCP --> PLG
    SHELL --> FILES

    PLG --> WR
    PLG --> SESS
    PLG --> AR
```

## Communication Channels

```mermaid
graph LR
    subgraph Channels
        direction TB
        A["1. HMR WebSocket<br/>(import.meta.hot)<br/>Events: browser → server<br/>Fallback relay: both ways"]
        B["2. capnweb RPC WebSocket<br/>(/__rpc)<br/>Typed bidirectional RPC<br/>~3ms round-trips"]
        C["3. MCP over SSE<br/>(/__mcp/sse)<br/>Agent ↔ server<br/>JSON-RPC 2.0"]
        D["4. Filesystem<br/>(/tmp/vite-harness-*)<br/>NDJSON log files<br/>id = line number = cursor"]
    end
```

### 1. HMR WebSocket (import.meta.hot)

Vite's built-in WebSocket. Browser pushes events via `import.meta.hot.send('harness:*', payload)`. Server listens with `server.hot.on('harness:*', handler)` and writes to NDJSON files. Also used as fallback for eval/query when capnweb isn't connected.

### 2. capnweb RPC WebSocket (/__rpc)

[capnweb](https://github.com/cloudflare/capnweb) object-capability RPC. Browser exposes `BrowserApi extends RpcTarget` with `document`, `window`, `localStorage`, `sessionStorage` getters. Each returns an `AnyTarget` proxy that dynamically forwards any property access or method call to the real browser object. Full DOM/Storage/Window API available without explicit declarations. ~3ms per call.

### 3. MCP over SSE (/__mcp/sse)

`@modelcontextprotocol/sdk` with `SSEServerTransport`. Each SSE connection gets its own `McpServer` instance. Tool handlers share state via `McpContext`.

### 4. Filesystem (NDJSON)

Event logs in `/tmp/vite-harness-{hash}/`. Each line: `{ id, ts, channel, payload }`. Files truncated on dev server start, rotated at `maxFileSizeMb`.

## Data Flow: eval_in_browser

```mermaid
sequenceDiagram
    participant Agent
    participant MCP as MCP Server
    participant RPC as capnweb
    participant Browser

    Agent->>MCP: tools/call eval_in_browser<br/>expression: "1+1"
    MCP->>MCP: getBrowserStub()
    alt capnweb connected
        MCP->>RPC: stub.eval("1+1")
        RPC->>Browser: RPC message
        Browser->>Browser: new Function("return (1+1)")()
        Browser->>RPC: RPC response: "2"
        RPC->>MCP: "2"
    else fallback to HMR
        MCP->>Browser: harness:eval via import.meta.hot
        Browser->>MCP: harness:eval-response
    end
    MCP->>Agent: { result: "2", duration_ms: 3 }
```

## Data Flow: Console Event → NDJSON

```mermaid
sequenceDiagram
    participant App as App Code
    participant Shim as Console Patch
    participant HMR as HMR WebSocket
    participant Writer as ConsoleWriter
    participant Disk as console.ndjson
    participant Notif as MCP Notifications

    App->>Shim: console.error("boom")
    Shim->>Shim: call original console.error
    Shim->>HMR: harness:console { level: "error", args: ["boom"] }
    Shim->>HMR: harness:error { type: "console-error", message: "boom" }
    HMR->>Writer: write console event
    Writer->>Disk: appendFileSync (NDJSON line)
    HMR->>Writer: write error event
    Writer->>Disk: appendFileSync (NDJSON line)
    HMR->>Notif: sendNotificationToAll()
```

## Virtual Module Injection

```mermaid
graph LR
    A["main.tsx<br/>(has createRoot)"] -->|"transform hook"| B["import 'virtual:vite-harness-client'<br/>+ original code"]
    B -->|loads| C[harness-client.ts<br/>console patch + error handlers]
    C -->|always| D[rpc-browser.ts<br/>capnweb BrowserApi]
    C -->|"if react: true"| E[react-adapter.ts<br/>bippy instrument]
    C -->|"if network: true"| F[fetch/XHR patches]
```

All virtual modules are plain JavaScript — Vite does not run TypeScript transforms on virtual modules.

## Component Map

```
src/
  index.ts              ← exports viteLiveDevMcp()
  plugin.ts             ← Vite plugin hooks, wires everything together
  mcp-server.ts         ← MCP tool definitions, SSE transport, relay helpers
  rpc-server.ts         ← capnweb WebSocket server, browser stub management
  session.ts            ← session ID, log dir, session.json, file truncation
  log-reader.ts         ← NDJSON reader with filtering/pagination
  auto-register.ts      ← writes .mcp.json, .cursor/mcp.json, .windsurf/mcp.json
  cli.ts                ← bin entry, wraps vite createServer
  types.ts              ← shared TypeScript interfaces
  writers/
    base.ts             ← NdjsonWriter (sync append, rotation), BufferedNdjsonWriter
    console.ts          ← console channel writer
    hmr.ts              ← HMR channel writer + status tracking
    errors.ts           ← errors channel writer
    network.ts          ← network channel writer (100ms buffered)
  client/
    harness-client.ts   ← browser shim: console patch, error handlers, fetch/XHR,
                           HMR relay handlers (eval, query-dom), loads RPC + react
    rpc-browser.ts      ← capnweb BrowserApi + AnyTarget dynamic proxy
    react-adapter.ts    ← bippy fiber hook + tree traversal (opt-in)
```
