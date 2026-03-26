# Gateway Operating Modes

## Mode 1: Proxy mode (current, `--target` provided)

Gateway sits in front of the dev server. Browser talks to gateway.

```mermaid
graph LR
    Browser -->|all requests| Gateway:3333
    Gateway -->|proxy| DevServer:3000
    Gateway -->|inject client.js into HTML| Browser

    subgraph Gateway:3333
        MCP[/__mcp/sse]
        RPC[/__rpc]
        CDP[/__cdp]
        Proxy[proxy everything else]
    end
```

Use case: any dev server (Next.js, Rails, Django, etc.) — zero config on the dev server side.

## Mode 2: Hub mode (new, no `--target`)

Gateway is a standalone MCP/RPC/CDP hub. Dev server connects TO the gateway (via adapter or rewrites). Browser talks to dev server directly.

```mermaid
graph LR
    Browser -->|pages| DevServer:3000
    Browser -->|/__rpc, /__events| Gateway:3333
    DevServer -->|register, dev-events| Gateway:3333

    subgraph Gateway:3333
        MCP[/__mcp/sse]
        RPC[/__rpc]
        CDP[/__cdp]
        Events[/__events]
        Registry[server registry]
    end

    subgraph DevServer:3000
        Adapter[vite plugin / next.js adapter]
        Rewrites[rewrites /__mcp → gateway]
    end
```

Use case: Next.js with `withWebDevMcp()` — the Next.js adapter injects the client script via webpack, and rewrites proxy MCP/RPC to the gateway. No need for the gateway to proxy pages.

## What changes

In hub mode without `--target`:
- No `http-proxy` needed
- Non-gateway routes return 404 (or a status page)
- Client script still served at `/__client.js`
- All MCP/RPC/CDP/events/registry endpoints work the same
- WebSocket upgrade for unknown paths → close (no proxy target)
