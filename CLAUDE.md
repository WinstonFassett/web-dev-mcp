# CLAUDE.md

## Project Overview

Monorepo with two packages that give AI agents live browser observability and control during development.

Two communication channels:
1. **HMR WebSocket** (`import.meta.hot`) — browser pushes events (console, errors, network) to server → NDJSON files
2. **capnweb RPC WebSocket** (`/__rpc`) — bidirectional object-capability RPC for DOM access, eval, screenshots

Two packages:
- `packages/vite-plugin` (`vite-live-dev-mcp`) — Vite plugin with embedded MCP server
- `packages/gateway` (`web-dev-mcp-gateway`) — Universal gateway: proxy, MCP server, capnweb routing

Two example apps:
- `examples/vite-app` — React + Vite test app
- `examples/nextjs-app` — Next.js test app

## Commands

```bash
npm run build                    # Build both packages
npm run build --workspace=vite-live-dev-mcp      # Build vite plugin only
npm run build --workspace=web-dev-mcp-gateway    # Build gateway only
```

### Development with examples
```bash
# Vite app (standalone mode)
cd examples/vite-app && npm run dev

# Gateway + Next.js (hub mode)
npx web-dev-mcp --port 3333          # Terminal 1: gateway
cd examples/nextjs-app && npm run dev  # Terminal 2: Next.js
```

### Testing MCP tools
```bash
# Gateway in hub mode with dynamic proxy
npx web-dev-mcp
# Browse: http://localhost:3333/https://example.com/
```

## Architecture

### MCP Server
Two toolsets selected via `?tools=` query param on SSE URL:
- `/__mcp/sse` — core tools: `get_diagnostics`, `clear`, `eval_capnweb` (3 tools)
- `/__mcp/sse?tools=full` — all tools including legacy click/fill/navigate/etc (23 tools)

`eval_capnweb` runs JS server-side with `document`/`window` as capnweb remote proxies. Has `browser.*` helpers (markdown, screenshot, navigate, click, fill, waitFor) and persistent `state` object across calls.

### capnweb Agent RPC
- `/__rpc/agent` — agents connect via capnweb WebSocket, get live remote DOM with promise pipelining
- `/__rpc` — browsers connect, expose `document`/`window` as `AnyTarget` proxies
- Gateway routes between agent and browser sessions

### Virtual Module Injection (Vite plugin)
Plugin injects `virtual:vite-harness-client` into files with `createRoot`/`ReactDOM.render`. Client source is in `packages/vite-plugin/client/` — loaded at runtime, NOT compiled by tsc (excluded in tsconfig).

### Gateway Dynamic Proxy
Hub mode (no `--target`): `http://localhost:3333/https://example.com/` proxies any URL, injects `<base>` tag for relative assets and client script for MCP/RPC.

### Log Files
NDJSON files in `.vite-mcp/` (vite) or `.web-dev-mcp/` (gateway):
- `console.ndjson`, `errors.ndjson`, `network.ndjson`, `hmr.ndjson` / `dev-events.ndjson`

Format: `{"id":1,"ts":1742654400123,"channel":"console","payload":{...}}`

## Key Files

### Gateway
- [packages/gateway/src/gateway.ts](packages/gateway/src/gateway.ts) — HTTP server, proxy, request routing
- [packages/gateway/src/mcp-server.ts](packages/gateway/src/mcp-server.ts) — MCP middleware, SSE transport, toolset selection
- [packages/gateway/src/mcp-tools-core.ts](packages/gateway/src/mcp-tools-core.ts) — Core tools: get_diagnostics, clear, eval_capnweb
- [packages/gateway/src/mcp-tools-full.ts](packages/gateway/src/mcp-tools-full.ts) — Legacy tools for MCP-only agents
- [packages/gateway/src/rpc-server.ts](packages/gateway/src/rpc-server.ts) — capnweb WebSocket, browser/agent connection management
- [packages/gateway/src/agent-client.ts](packages/gateway/src/agent-client.ts) — `connect()` helper for agent scripts
- [packages/gateway/src/client/index.ts](packages/gateway/src/client/index.ts) — Browser-side client (bundled to dist/client.js)

### Vite Plugin
- [packages/vite-plugin/plugin.ts](packages/vite-plugin/plugin.ts) — Vite hooks, virtual module injection, middleware
- [packages/vite-plugin/mcp-server.ts](packages/vite-plugin/mcp-server.ts) — MCP tools (full set, standalone mode)
- [packages/vite-plugin/rpc-server.ts](packages/vite-plugin/rpc-server.ts) — capnweb WebSocket for browser stubs
- [packages/vite-plugin/client/](packages/vite-plugin/client/) — Virtual modules (runtime source, not tsc-compiled)

## Common Gotchas

- After changing plugin code, must run `npm run build` for examples to pick up changes
- Virtual module client files are in `client/` not `src/client/` — tsconfig excludes them
- `eval_in_browser` uses `new Function()` — blocked by CSP on non-local sites. Use `eval_capnweb` instead.
- Gateway `client.js` is large (bundled browser client) — published as-is for now
- After `navigate()`, browser reconnects RPC — wait before next tool call
