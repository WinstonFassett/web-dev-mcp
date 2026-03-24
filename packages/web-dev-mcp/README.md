# web-dev-mcp

Universal MCP gateway for web development. Proxy any dev server to give AI agents live browser observability — console logs, errors, network requests, DOM queries, and JS evaluation.

Works with **any** HTTP dev server: Next.js, Vite, Remix, Rails, Django, static files, etc.

## Quick Start

```bash
# Terminal 1: Start your dev server (any framework)
npm run dev  # → localhost:3000

# Terminal 2: Start the gateway
npx web-dev-mcp --target http://localhost:3000

# Browser: Visit http://localhost:3333 (proxied + instrumented)
# LLM: Connect MCP to http://localhost:3333/__mcp/sse
```

## How It Works

```
Browser ──→ Gateway (:3333) ──→ Dev Server (:3000)
   │             │
   ├─ /__events  │  Console/error/network events (WebSocket)
   ├─ /__rpc     │  Eval/DOM queries via capnweb RPC (WebSocket)
   └─ /__mcp/sse │  MCP tools for AI agents (SSE)
```

1. Gateway proxies all HTTP/WebSocket traffic to your dev server
2. HTML responses get a `<script>` tag injected that loads the client
3. Client patches `console.*`, error handlers, and `fetch`/`XHR`
4. Events stream to gateway via WebSocket → written to NDJSON log files
5. capnweb RPC enables bidirectional browser communication (eval, DOM queries)
6. MCP server exposes tools that AI agents can call

## MCP Tools

| Tool | Description |
|------|-------------|
| `get_session_info` | Log paths, server URLs, active channels |
| `get_diagnostics` | Consolidated logs + summary (single call) |
| `get_logs` | Query specific channel with filtering/pagination |
| `clear_logs` | Truncate logs, set checkpoint for incremental reads |
| `eval_in_browser` | Run JavaScript in the browser, return result |
| `query_dom` | CSS selector → cleaned HTML snapshot |
| `wait_for_condition` | Poll until JS expression is truthy |

## CLI Options

```
npx web-dev-mcp --target <url> [options]

Options:
  --target, -t <url>   Dev server URL to proxy (required)
  --port, -p <port>    Gateway port (default: 3333)
  --network            Capture fetch/XHR requests
  --help, -h           Show help
```

## Architecture

### Client (injected into browser)

- Patches `console.log/warn/error/info/debug` → sends to `/__events` WebSocket
- Registers `window.error` and `unhandledrejection` handlers
- Patches `fetch` and `XMLHttpRequest` (when `--network` flag used)
- Connects capnweb RPC to `/__rpc` for eval/queryDom/CDP

### Server (gateway process)

- HTTP proxy via `http-proxy` with HTML response interception
- Events WebSocket (`/__events`) → NDJSON writers (console, errors, network)
- RPC WebSocket (`/__rpc`) → capnweb sessions for browser communication
- MCP SSE server (`/__mcp/sse`) → tools for AI agents
- Session management → `/tmp/web-dev-mcp-{hash}/` log files

### Log Files

Created in `/tmp/web-dev-mcp-{hash}/`:
- `session.json` — metadata
- `console.ndjson` — console logs
- `errors.ndjson` — errors + unhandled exceptions
- `network.ndjson` — fetch/XHR (opt-in with `--network`)

## Development

```bash
cd packages/web-dev-mcp
npm install
npm run build          # tsc + esbuild client bundle

# Test with included test server
node test-target.mjs   # Simple HTML server on :4567
node dist/cli.js --target http://localhost:4567 --network
node test-gateway.mjs  # Playwright test
```
