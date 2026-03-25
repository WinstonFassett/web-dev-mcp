# Web Dev MCP Architecture

## Overview

Three operating modes for live dev observability via MCP:

## 1. Standalone Mode (Vite Plugin Only)

```mermaid
graph TB
    Browser[Browser<br/>localhost:5173]
    ViteServer[Vite Dev Server<br/>+ vite-live-dev-mcp plugin]
    Agent[AI Agent<br/>Claude/Cursor/etc]

    Browser -->|HMR WebSocket| ViteServer
    Browser -->|RPC WebSocket<br/>__rpc| ViteServer
    Browser -->|CDP WebSocket<br/>__cdp| ViteServer

    ViteServer -->|NDJSON logs<br/>.vite-mcp/| Disk[.vite-mcp/<br/>console.ndjson<br/>hmr.ndjson<br/>errors.ndjson]

    Agent -->|MCP SSE<br/>:5173/__mcp/sse| ViteServer
    ViteServer -.->|reads logs| Disk
    ViteServer -.->|RPC eval/DOM| Browser
```

**Characteristics:**
- Direct MCP connection to Vite server
- Logs in project folder: `.vite-mcp/`
- Each restart = new MCP connection
- Port-specific MCP endpoint

---

## 2. Proxy Mode (Gateway Only)

```mermaid
graph TB
    Browser[Browser<br/>localhost:3333]
    Gateway[Gateway<br/>localhost:3333]
    NextJS[Next.js Server<br/>localhost:3000]
    Agent[AI Agent]

    Browser -->|HTTP| Gateway
    Gateway -->|Proxy| NextJS
    NextJS -->|HTML| Gateway
    Gateway -->|Injected Script<br/>__client.js| Browser

    Browser -->|Events WebSocket<br/>__events| Gateway
    Browser -->|RPC WebSocket<br/>__rpc| Gateway
    Browser -->|CDP WebSocket<br/>__cdp| Gateway

    Gateway -->|NDJSON logs<br/>.web-dev-mcp/| Disk[.web-dev-mcp/<br/>console.ndjson<br/>errors.ndjson<br/>network.ndjson]

    Agent -->|MCP SSE<br/>:3333/__mcp/sse| Gateway
    Gateway -.->|reads logs| Disk
    Gateway -.->|RPC eval/DOM| Browser
```

**Characteristics:**
- Gateway proxies non-Vite apps (Next.js, Remix, etc.)
- Injects observability client into HTML
- Logs in gateway folder: `.web-dev-mcp/`
- Single target server
- Persistent MCP endpoint (survives app restarts)

---

## 3. Hybrid Mode (Plugin + Gateway)

```mermaid
graph TB
    subgraph "Project 1 - Vite"
        Browser1[Browser<br/>localhost:4501]
        Vite1[Vite Server<br/>localhost:4501<br/>+ plugin]
        Logs1[.vite-mcp/<br/>logs]
    end

    subgraph "Project 2 - Next.js"
        Browser2[Browser<br/>localhost:3000<br/>via gateway proxy]
        Next2[Next.js Server<br/>localhost:3000]
        Logs2[.web-dev-mcp/<br/>logs]
    end

    Gateway[Gateway<br/>localhost:3333<br/>ServerRegistry]
    Agent[AI Agent]

    Vite1 -->|Register<br/>POST /__gateway/register<br/>type, port, pid, logPaths| Gateway

    Browser1 -->|Direct access| Vite1
    Browser1 -.->|RPC<br/>ws://localhost:4501/__rpc| Vite1
    Vite1 -->|writes| Logs1

    Browser2 -->|Proxy<br/>http://localhost:3333| Gateway
    Gateway -->|Proxy HTML| Next2
    Gateway -->|Inject script +<br/>window.__WEB_DEV_MCP_SERVER__| Browser2
    Browser2 -.->|RPC<br/>ws://localhost:3333/__rpc?server=vite-4501| Gateway
    Gateway -->|writes| Logs2

    Agent -->|MCP SSE<br/>:3333/__mcp/sse| Gateway

    Gateway -.->|Delegates to<br/>registered server| Vite1
    Gateway -.->|Reads logs from| Logs1
    Gateway -.->|Reads logs from| Logs2
    Gateway -.->|Routes RPC by serverId| Browser1
    Gateway -.->|Routes RPC by serverId| Browser2

    style Gateway fill:#f9f,stroke:#333,stroke-width:4px
```

**Characteristics:**
- Multiple projects register with single gateway
- Each project keeps its own logs in project folder
- Single persistent MCP endpoint for all projects
- Browser-to-server association via `?server=` query param
- Gateway delegates queries to registered servers
- Automatic cleanup of dead servers (heartbeat)

---

## Registration Flow (Hybrid Mode)

```mermaid
sequenceDiagram
    participant Vite as Vite Server
    participant Gateway
    participant Registry as ServerRegistry

    Vite->>Vite: On startup, check options.gateway
    Vite->>Gateway: POST /__gateway/register<br/>{type:"vite", port, pid, logPaths, rpcEndpoint}
    Gateway->>Registry: registry.add(server)
    Registry->>Registry: Track in Map, connectionOrder
    Registry->>Registry: Start heartbeat (5s interval)
    Gateway-->>Vite: {success, gatewayMcpUrl, serverId}
    Vite->>Vite: Log: "registered with gateway"

    loop Every 5 seconds
        Registry->>Registry: cleanupDeadServers()
        Registry->>Registry: process.kill(pid, 0) for each server
        Registry->>Registry: Remove if dead
    end
```

---

## Browser Connection Flow (Hybrid Mode)

```mermaid
sequenceDiagram
    participant Browser
    participant Gateway
    participant Vite as Vite Server

    Note over Browser: User opens http://localhost:3333
    Gateway->>Vite: Proxy HTTP request
    Vite-->>Gateway: HTML response
    Gateway->>Gateway: Inject:<br/>window.__WEB_DEV_MCP_SERVER__='vite-4501'<br/><script src="/__client.js"></script>
    Gateway-->>Browser: Modified HTML

    Browser->>Browser: Execute client script
    Browser->>Browser: Read window.__WEB_DEV_MCP_SERVER__
    Browser->>Browser: Build RPC URL:<br/>ws://localhost:3333/__rpc?server=vite-4501

    Browser->>Gateway: WebSocket connect<br/>ws://localhost:3333/__rpc?server=vite-4501
    Gateway->>Gateway: Parse server ID from query param
    Gateway->>Gateway: Store BrowserConnection:<br/>{stub, browserId, serverId}
    Gateway-->>Browser: Connected

    Note over Browser,Gateway: Browser associated with server!
```

---

## MCP Query Routing (Hybrid Mode)

```mermaid
sequenceDiagram
    participant Agent as AI Agent
    participant Gateway
    participant Registry
    participant Logs as Project Logs
    participant Browser

    Agent->>Gateway: MCP: get_diagnostics()
    Gateway->>Registry: registry.getLatest()
    Registry-->>Gateway: server = {id, logPaths}
    Gateway->>Logs: Read logs from server.logPaths
    Logs-->>Gateway: NDJSON events
    Gateway-->>Agent: {hmr, logs, summary}

    Agent->>Gateway: MCP: eval_in_browser("document.title")
    Gateway->>Gateway: getLatestBrowserByServer(serverId)
    Gateway->>Browser: RPC: stub.eval("document.title")
    Browser-->>Gateway: "Test App"
    Gateway-->>Agent: "Test App"
```

---

## File Structure

```
project-root/
├── .vite-mcp/              # Vite plugin logs (per project)
│   ├── session.json
│   ├── console.ndjson
│   ├── hmr.ndjson
│   ├── errors.ndjson
│   └── network.ndjson
│
├── packages/web-dev-mcp/
│   └── .web-dev-mcp/       # Gateway logs (where gateway runs)
│       ├── session.json
│       ├── console.ndjson
│       ├── errors.ndjson
│       └── dev-events.ndjson
│
└── test-app-nextjs/
    └── .next/              # Next.js build (no MCP logs)
```

---

## Key Design Decisions

### 1. Log Isolation
- **Per-project logs** in `.vite-mcp/` (not `/tmp`)
- Avoids permission issues
- Better organization
- Survives across restarts with stable location

### 2. Browser Association
- `window.__WEB_DEV_MCP_SERVER__` injected by gateway
- Appended to RPC URL: `?server=vite-4501`
- Gateway parses and stores in `BrowserConnection.serverId`
- Enables multi-project browser queries

### 3. Registration API
- Simple HTTP POST to `/__gateway/register`
- Includes `logPaths` for delegation
- Heartbeat cleanup removes dead servers
- No manual unregistration needed

### 4. Query Delegation
- MCP tools check for registered servers
- If hybrid mode: use `registry.getLatest().logPaths`
- If standalone: use plugin's own logs
- Fallback gracefully

---

## API Endpoints

### Gateway Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/__gateway/register` | POST | Register dev server |
| `/__gateway/servers` | GET | List registered servers |
| `/__gateway/unregister/:id` | POST | Remove server |
| `/__status` | GET | Full gateway status |
| `/__mcp/sse` | GET | MCP Server-Sent Events |
| `/__rpc` | WebSocket | RPC for eval/DOM queries |
| `/__cdp` | WebSocket | Chrome DevTools Protocol |
| `/__events` | WebSocket | Browser events stream |
| `/__client.js` | GET | Injected client bundle |

### Vite Plugin Endpoints (when standalone)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/__mcp/sse` | GET | MCP Server-Sent Events |
| `/__rpc` | WebSocket | RPC for eval/DOM queries |
| `/__cdp` | WebSocket | Chrome DevTools Protocol |

---

## Current Multi-Project Setup

We already have multi-project in this repo:

1. **test-app** (Vite with plugin)
   - Registers with gateway
   - Logs: `test-app/.vite-mcp/`
   - Can be accessed directly: `http://localhost:4501`

2. **test-app-nextjs** (Next.js, no plugin)
   - Accessed through gateway proxy
   - Logs: Gateway writes to `.web-dev-mcp/`
   - Accessed via: `http://localhost:3333` (gateway proxy)

Both use **one gateway instance** at `localhost:3333` for MCP queries.
