# @winstonfassett/web-dev-mcp-gateway

Universal MCP gateway for web development. Give AI agents live browser observability during development — console logs, errors, network requests, DOM queries, screenshots, and JS evaluation.

A dev sidecar, not a browser automation tool. The agent sees your browser tab, with your auth and state.

Works with **any** HTTP dev server: Next.js, Vite, Remix, Rails, Django, static files.

## Quick Start (standalone proxy)

```bash
# Start your dev server
npm run dev  # → localhost:3000

# Start the gateway
npx web-dev-mcp --target http://localhost:3000

# Browse http://localhost:3333 (proxied + instrumented)
# MCP endpoint: http://localhost:3333/__mcp/sse
```

## Framework Adapters

For deeper integration (auto-start, build events, HMR status), use a framework adapter:

| Framework | Package | Setup |
|-----------|---------|-------|
| Vite | [`@winstonfassett/web-dev-mcp-vite`](https://www.npmjs.com/package/@winstonfassett/web-dev-mcp-vite) | 2-line plugin |
| Storybook | [`@winstonfassett/web-dev-mcp-vite`](https://www.npmjs.com/package/@winstonfassett/web-dev-mcp-vite) | 1-line addon |
| Next.js | [`@winstonfassett/web-dev-mcp-nextjs`](https://www.npmjs.com/package/@winstonfassett/web-dev-mcp-nextjs) | 1-line config wrapper |

Adapters auto-start the gateway — no separate terminal needed.

## How It Works

```
Browser ──→ Gateway (:3333) ──→ Dev Server (:3000)
   │             │
   ├─ /__events  │  Console/error/network events (WebSocket)
   ├─ /__rpc     │  JSON commands — eval, screenshot, click, etc. (WebSocket)
   └─ /__mcp/sse │  MCP tools for AI agents (SSE)
```

1. Gateway proxies all HTTP/WebSocket traffic to your dev server
2. Injected `<script>` patches `console.*`, error handlers, `fetch`/`XHR`
3. Events stream to gateway → written to NDJSON log files
4. JSON command channel enables browser interaction (eval, screenshot, click, etc.)
5. MCP server exposes tools that AI agents call

## MCP Tools (core set)

| Tool | Description |
|------|-------------|
| `set_project` | Set active project (when multiple dev servers are registered) |
| `list_projects` | List registered dev servers + gateway |
| `list_browsers` | List connected browser tabs |
| `get_diagnostics` | Consolidated logs + errors + build status snapshot |
| `clear` | Truncate logs, set checkpoint for incremental reads |
| `eval_js` | Run JS in browser with full DOM access. Auto-awaits promises. Accepts `string \| string[]` for auto-waited pipelines. Persistent `state` + `browser.*` helpers |

Full toolset (23 tools): `/__mcp/sse?tools=full`

## CLI

```
npx web-dev-mcp [options]

Options:
  --target, -t <url>     Dev server URL to proxy
  --port, -p <port>      Gateway port (default: 3333)
  --network              Capture fetch/XHR requests
  --auto-register        Write MCP config to .mcp.json, .cursor/, .windsurf/, .vscode/
  --help, -h             Show help
```

## License

MIT
