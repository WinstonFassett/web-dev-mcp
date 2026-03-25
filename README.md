# vite-live-dev-mcp

Vite plugin and universal gateway that give AI coding agents live observability and browser control during development — console logs, HMR events, network requests, DOM queries, and JS evaluation — via NDJSON log files, MCP servers, and bidirectional RPC.

**Three deployment modes:**
- **Standalone** — Vite plugin with embedded MCP server
- **Proxy** — Universal gateway for Next.js, Remix, or any dev server
- **Hybrid** — Multiple projects register with one persistent gateway

```mermaid
graph TB
    subgraph "Standalone Mode"
        A1[AI Agent] <-->|MCP| V1[Vite + Plugin]
        V1 <-->|RPC| B1[Browser]
    end

    subgraph "Hybrid Mode"
        A2[AI Agent] <-->|MCP| GW[Gateway<br/>localhost:3333]
        GW -.->|delegates| V2[Vite :5173]
        GW -.->|delegates| N2[Next.js :3000]
        V2 <-->|RPC| B2[Browser]
        GW <-->|RPC| B3[Browser]
    end
```

See **[docs/architecture.md](docs/architecture.md)** for detailed diagrams and flows.

## Quick Start

### Vite Plugin (Standalone)

```bash
npm install -D vite-live-dev-mcp
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteLiveDevMcp } from 'vite-live-dev-mcp'

export default defineConfig({
  plugins: [
    react(),
    viteLiveDevMcp({
      network: true,   // opt-in: log fetch/XHR requests
      gateway: true,   // opt-in: register with gateway for hybrid mode
      // react: true,   // opt-in: enable get_react_tree (requires bippy)
    }),
  ],
})
```

Or use the CLI wrapper (auto-injects the plugin):

```bash
npx vite-live-dev-mcp
npx vite-live-dev-mcp --network --port 3000
```

On startup:

```
  ➜  vite-live-dev-mcp: http://localhost:5173/__mcp/sse
  ➜  CDP endpoint: http://localhost:5173/__cdp
  ➜  log dir: /Users/you/project/.vite-mcp
  ➜  registered with gateway: http://localhost:3333/__mcp/sse
```

### Universal Gateway (Proxy Mode)

For Next.js, Remix, or any framework without a Vite plugin:

```bash
npx web-dev-mcp --target http://localhost:3000 --port 3333
```

Or install globally:

```bash
npm install -g web-dev-mcp
web-dev-mcp --target http://localhost:3000
```

The gateway proxies your app and injects observability. Access via `http://localhost:3333`.

### Hybrid Mode (Multi-Project)

Run the gateway once, have multiple projects register with it:

```bash
# Terminal 1: Start gateway
web-dev-mcp --target http://localhost:3000 --port 3333

# Terminal 2: Start Vite with gateway registration
cd project-1 && npm run dev  # vite.config.ts has gateway: true

# Terminal 3: Start another Vite project
cd project-2 && npm run dev  # also registers with gateway
```

All projects share one MCP endpoint at `http://localhost:3333/__mcp/sse` — survives individual app restarts.

### MCP Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "vite-mcp": {
      "type": "sse",
      "url": "http://localhost:5173/__mcp/sse"
    }
  }
}
```

Or for hybrid mode:

```json
{
  "mcpServers": {
    "web-dev-gateway": {
      "type": "sse",
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```

## MCP Tools

### Observation

| Tool | Purpose |
|---|---|
| `get_session_info` | Returns log dir, file paths, server URL. Call first to orient. |
| `get_diagnostics` | **Consolidated diagnostics** — console + errors + network logs + HMR status + auto-computed summary in a single call. Replaces 4-5 separate `get_logs()` calls. **2-3x faster** for agent test/fix loops. Supports `since_checkpoint` filtering. |
| `get_hmr_status` | HMR update/error counts, pending state. Lightweight poll. |
| `get_logs` | Query log files with cursor pagination, level filtering, text search. |
| `clear_logs` | Truncate log files. Call before a fix iteration for a clean slate. Sets checkpoint for `get_diagnostics(since_checkpoint=true)`. |
| `get_react_tree` | React component tree snapshot (requires `react: true` + `bippy`). |

### Browser Control

| Tool | Purpose |
|---|---|
| `eval_in_browser` | Run arbitrary JavaScript in the browser, return the result. |
| `query_dom` | Query DOM by CSS selector, return cleaned HTML with agent-controlled depth, attributes, and text truncation. |
| `wait_for_condition` | **Server-side polling** — blocks until browser condition (JS expression) is truthy or timeout. Eliminates manual polling loops. Default: 5s timeout, 100ms interval. |

## How It Works

Three communication channels:

1. **HMR WebSocket** (`import.meta.hot`) — browser pushes events (console, errors, network) to server, which writes them to NDJSON files. Also used as fallback for eval/query.

2. **capnweb RPC WebSocket** (`/__rpc`) — bidirectional object-capability RPC. Server holds proxy stubs to browser objects (`document`, `window`, `localStorage`, `sessionStorage`). Full DOM/Storage/Window API available via dynamic proxy — any property or method call is transparently forwarded. ~3ms per round-trip.

3. **CDP WebSocket** (`/__cdp/devtools/...`) — Chrome DevTools Protocol endpoint for Playwright `connectOverCDP`. Proxies CDP commands through capnweb RPC to Chobitsu (in-browser CDP implementation).

## Playwright Integration

Connect Playwright to your running dev server without launching a separate browser:

```javascript
import { chromium } from 'playwright'

// Connect to the live browser
const browser = await chromium.connectOverCDP('http://localhost:5173/__cdp')
const page = browser.contexts()[0].pages()[0]

// Interact with the dev page
await page.click('button')
console.log(await page.title())
```

CDP endpoints:
- `/__cdp/json/version` — browser version info
- `/__cdp/json` — list of connected pages
- `/__cdp/devtools/browser` — WebSocket for latest browser
- `/__cdp/devtools/page/:id` — WebSocket for specific browser by ID

## Agent Workflow

### Fast Path (Recommended)

```
# 1. Orient
get_session_info → note file paths, server URL

# 2. Before a task
clear_logs → clean slate (sets checkpoint)

# 3. Make code changes (HMR fires automatically)

# 4. Check results with single call
get_diagnostics({ since_checkpoint: true })
→ Returns: console logs, errors, network, HMR status, summary stats
→ Summary: error_count, warning_count, failed_requests, has_unhandled_rejections
→ 2-3x faster than separate get_logs() calls

# 5. Wait for async conditions
wait_for_condition({ check: "document.querySelector('.loaded')" })

# 6. Inspect the DOM
query_dom({ selector: "#root", max_depth: 2 })
eval_in_browser({ expression: "document.title" })

# 7. If broken: read errors, fix, repeat from step 2
```

### Granular Path (for targeted queries)

```
# Use individual tools when you need specific filtering:
get_hmr_status → any errors?
get_logs({ channel: "errors", limit: 10 })
get_logs({ channel: "console", search: "counter", since_id: 5 })
```

## API Details

### get_diagnostics

Consolidated endpoint that returns all log channels + HMR status + summary stats in a single call.

**Parameters:**
- `since_checkpoint` (boolean) — Filter events since last `clear_logs()`. Default: false
- `since_ts` (number) — Filter events since Unix timestamp (ms)
- `limit` (number) — Max events per channel. Default: 50, max: 200
- `level` (string) — Filter by level (e.g. "error", "warn")
- `search` (string) — Text search across event payloads (case-insensitive)

**Returns:**
```typescript
{
  hmr: {
    last_update_at: number | null
    last_error_at: number | null
    last_error: string | undefined
    update_count: number
    error_count: number
    pending: boolean
  },
  logs: {
    console: HarnessEvent[]
    errors: HarnessEvent[]
    network: HarnessEvent[]
  },
  summary: {
    error_count: number
    warning_count: number
    failed_requests: number
    has_unhandled_rejections: boolean
  },
  checkpoint_ts: number | null
}
```

**Example:**
```javascript
// After clear_logs(), get all new events
const diag = await get_diagnostics({ since_checkpoint: true })

if (diag.summary.error_count > 0) {
  console.log('Errors:', diag.logs.errors)
}
```

### wait_for_condition

Server-side polling that blocks until a browser condition is truthy or timeout.

**Parameters:**
- `check` (string, required) — JavaScript expression to evaluate (must return truthy)
- `timeout` (number) — Timeout in ms. Default: 5000
- `interval` (number) — Poll interval in ms. Default: 100

**Returns:**
```typescript
{
  success: boolean
  value: any  // final value of expression
  elapsed_ms: number
}
```

**Example:**
```javascript
// Wait for element to appear
await wait_for_condition({
  check: "document.querySelector('.success-message')",
  timeout: 10000
})

// Wait for counter to reach value
await wait_for_condition({
  check: "window.__counter >= 5",
  interval: 50
})
```

### clear_logs (with checkpoint)

Truncates log files and sets a checkpoint timestamp. Use `get_diagnostics({ since_checkpoint: true })` to see only new events after the checkpoint.

**Parameters:**
- `channels` (string[]) — Channels to clear. Default: all active. Pass `['all']` for all.

**Example:**
```javascript
// Clear logs before making changes
await clear_logs()

// Make changes, wait for HMR...

// Get only new events since checkpoint
const diag = await get_diagnostics({ since_checkpoint: true })
```

## Options

### Vite Plugin Options

```ts
viteLiveDevMcp({
  mcpPath: '/__mcp',            // MCP endpoint path (default: '/__mcp')
  network: false,                // log fetch/XHR (default: false)
  react: false,                  // enable get_react_tree (default: false)
  gateway: false,                // register with gateway (default: false, or URL)
  networkOptions: {
    excludePatterns: ['/__', '/@', '/node_modules'],
  },
  logDir: undefined,             // override default (default: {projectRoot}/.vite-mcp)
  maxFileSizeMb: 10,             // per-channel rotation threshold
  autoRegister: false,           // write .mcp.json etc on startup (default: false)
  notifications: true,           // MCP notifications for errors (default: true)
  printUrl: true,                // print MCP URL on startup (default: true)
})
```

### Gateway CLI Options

```bash
web-dev-mcp --target <url> [options]

Options:
  -t, --target <url>      Target dev server URL (required in proxy mode)
  -p, --port <port>       Gateway port (default: 3333)
  --host [host]           Bind to host (default: localhost)
  --https                 Use HTTPS with self-signed cert
  --cert <path>           Custom HTTPS cert path
  --key <path>            Custom HTTPS key path
  --network               Capture fetch/XHR requests
  --react                 Enable React tree inspection (requires bippy)
  --log-dir <path>        Override log directory
```

## CLI

### Vite Plugin CLI

```
vite-live-dev-mcp [root] [options]

Options:
  -p, --port <port>       Port (default: 5173)
  --host [host]           Expose to network
  --open                  Open browser on start
  -c, --config <file>     Vite config file
  -m, --mode <mode>       Vite mode
  --network               Capture fetch/XHR requests
  --react                 Enable React tree inspection
  --gateway [url]         Register with gateway (default: http://localhost:3333)
  --no-auto-register      Skip writing MCP configs
  -h, --help              Show help
```

The CLI auto-injects the plugin if it's not already in your vite config.

## Log Files

### Vite Plugin Logs

Logs are stored in your project directory:

```
{projectRoot}/.vite-mcp/
  session.json          ← session metadata
  console.ndjson        ← always active
  hmr.ndjson            ← always active
  errors.ndjson         ← always active
  network.ndjson        ← opt-in (network: true)
  react.ndjson          ← opt-in (react: true)
```

### Gateway Logs

Gateway logs are stored where the gateway runs:

```
{cwd}/.web-dev-mcp/
  session.json
  console.ndjson
  errors.ndjson
  dev-events.ndjson
  network.ndjson        ← opt-in (--network)
```

### Format

One JSON object per line. `id` = line number = cursor position.

```json
{"id":1,"ts":1742654400123,"channel":"console","payload":{"level":"error","args":["something broke"]}}
{"id":2,"ts":1742654400456,"channel":"console","payload":{"level":"log","args":["counter: 5"]}}
```

Files are truncated on each dev server start. In hybrid mode, each registered server maintains its own logs.

## Hybrid Mode Details

When using `gateway: true` in your Vite config:

1. **Registration**: Vite sends `POST /__gateway/register` with server metadata (type, port, PID, log paths)
2. **Heartbeat**: Gateway checks registered servers every 5s, removes dead processes
3. **Delegation**: MCP queries are routed to the appropriate registered server
4. **Browser Association**: Browsers include `?server=vite-5173` in RPC connections for proper isolation
5. **Persistence**: Gateway MCP endpoint survives individual app restarts

Query gateway status:
```bash
curl http://localhost:3333/__status
curl http://localhost:3333/__gateway/servers
```

## React Tree (opt-in)

```bash
npm install -D bippy
```

```ts
viteLiveDevMcp({ react: true })
```

The `get_react_tree` MCP tool returns component names, props, and state.

## Requirements

- **Vite Plugin**: Vite 6+, Node 20.19+
- **Gateway**: Node 20.19+
- **React Tree**: React 17–19 with bippy

## Packages

- `vite-live-dev-mcp` — Vite plugin (this package)
- `web-dev-mcp` — Universal gateway in `packages/web-dev-mcp/`

## Architecture

See **[docs/architecture.md](docs/architecture.md)** for:
- Detailed Mermaid diagrams of all three modes
- Registration and browser connection flows
- MCP query routing in hybrid mode
- File structure and API endpoints

## License

MIT
