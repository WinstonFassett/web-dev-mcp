# vite-live-dev-mcp — Specification v0.2

> A Vite plugin that gives AI coding agents (primarily Claude Code) live observability into a running React app during development — console logs, HMR events, network requests, and React component state — by writing structured event streams to local tmp files and exposing a minimal MCP server for orientation and structured queries.

---

## 1. Problem Statement

AI coding agents editing frontend code are blind. They write a change, HMR fires, and they have no reliable way to know whether the result was correct, broken, or silently wrong. Existing options either require a separate browser process (blowback, Playwright MCP — heavy, token-expensive), miss the polling gap between agent turns (pure terminal forwarding), or lack React context entirely.

`vite-live-dev-mcp` solves this by:
1. Writing all runtime events (console, HMR, network, React) to local NDJSON files in `/tmp`
2. Exposing a minimal MCP server for orientation and structured queries
3. Letting the agent use its own native file tools (`grep`, `tail`, `cat`, `wc`) for log analysis

The MCP server is thin. The files are the interface.

---

## 2. Goals and Non-Goals

### Goals
- Vite plugin that embeds an MCP server at `/__mcp/sse` (same process, same port as Vite dev server)
- Write runtime events to stable tmp files per project, truncated on each dev server start
- Four MCP tools: `get_session_info`, `get_hmr_status`, `clear_logs`, `get_react_tree`
- React 17–19 fiber access via `bippy` (no browser extension required), opt-in, on-demand snapshot
- Network request logging (opt-in, client-side monkey-patch)
- Auto-register `.claude/mcp.json`, `.cursor/mcp.json`, `.windsurf/mcp.json`
- MCP notifications for unhandled errors and HMR failures (best-effort push)
- Vite 8+, Node 20.19+, TypeScript-first, zero production footprint

### Non-Goals (v1)
- Vue, Svelte, or other framework adapters
- Screenshot capture (delegate to `agent-browser` or `chrome-devtools-mcp`)
- `eval_in_browser` / dynamic listener injection (v2 — see §13)
- `npx` zero-touch wrapper (v2)
- Configurable log retention across restarts (tmp files are session-scoped)
- Webpack / Rollup support

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Vite Dev Server (single process)                              │
│                                                                │
│  ┌──────────────────────┐    ┌────────────────────────────┐   │
│  │  harness plugin       │    │  MCP server                │   │
│  │  configureServer ────▶│    │  /__mcp/sse (SSE)          │   │
│  │  event writers        │    │  4 tools                   │   │
│  │  file paths           │    │  notifications             │   │
│  └──────────┬────────────┘    └────────────────────────────┘   │
│             │                                                   │
│    /tmp/vite-harness-{hash}/                                   │
│             │  console.ndjson                                  │
│             │  hmr.ndjson                                      │
│             │  errors.ndjson                                   │
│             │  network.ndjson  (opt-in)                        │
│             │  react.ndjson    (opt-in)                        │
│             │  session.json                                    │
└─────────────┼──────────────────────────────────────────────────┘
              │ import.meta.hot WebSocket (existing Vite channel)
┌─────────────▼──────────────────────────────────────────────────┐
│  Browser (client shim, injected by plugin)                     │
│  harness-client.ts (virtual module)                            │
│  - patches console.*                                           │
│  - patches window.fetch / XHR (opt-in)                        │
│  - bippy fiber hook (opt-in)                                   │
│  - events → import.meta.hot.send('harness:*', payload)         │
└────────────────────────────────────────────────────────────────┘
```

### Key design decisions

- **Files are the interface.** The MCP server orients the agent and provides structured queries. Log data lives in files. The agent uses `grep`, `tail`, `cat`, `wc` on those paths.
- **Same process.** The MCP server is a middleware on the Vite dev server. No second process, no second port.
- **`import.meta.hot` is the relay.** The existing Vite WebSocket carries events from browser to server. No new sockets.
- **Vite 8 `forwardConsole` is superseded.** When the plugin is active it sets `server.forwardConsole: false` internally to avoid duplicate terminal output. The plugin's writers replace that function with richer structured output.

---

## 4. Tmp File Layout

```
/tmp/vite-harness-{hash}/
  session.json          ← written on server start, updated on close
  console.ndjson        ← always active
  hmr.ndjson            ← always active  
  errors.ndjson         ← always active (subset: errors + unhandled rejections)
  network.ndjson        ← opt-in (network: true)
  react.ndjson          ← opt-in (react: true), written on get_react_tree calls
```

`{hash}` is a short hash of the project root path. This gives a stable, predictable path across restarts for the same project.

**On dev server start:** all `.ndjson` files are truncated to zero bytes. `session.json` is rewritten. This means each dev session starts with a clean slate.

**File format:** NDJSON — one JSON object per line, newline-terminated.

```json
{"id":1,"ts":1742654400123,"channel":"console","payload":{"level":"error","args":["test-error-marker"],"file":"src/App.tsx","line":12}}
{"id":2,"ts":1742654400456,"channel":"console","payload":{"level":"log","args":["counter: 5"]}}
```

`id` is a monotonically increasing integer, reset to 1 on each session start. It equals the line number. An agent can do `sed -n '47,$p' console.ndjson` to get events from id 47 onward — no cursor API needed.

**Write strategy:**
- `console`, `hmr`, `errors`: `fs.appendFileSync` — synchronous, survives crashes
- `network`: buffered 100ms, then flushed — XHR/fetch can be high-volume
- `react`: written only on `get_react_tree` tool calls, not streaming

**Max file size:** 10MB per channel by default. On breach, rotate to `.ndjson.1` and continue fresh. `.ndjson.1` persists for the session.

### `session.json` format

```json
{
  "sessionId": "a3f9b2",
  "projectRoot": "/Users/dev/myapp",
  "logDir": "/tmp/vite-harness-a3f9b2",
  "files": {
    "console": "/tmp/vite-harness-a3f9b2/console.ndjson",
    "hmr": "/tmp/vite-harness-a3f9b2/hmr.ndjson",
    "errors": "/tmp/vite-harness-a3f9b2/errors.ndjson",
    "network": "/tmp/vite-harness-a3f9b2/network.ndjson",
    "react": "/tmp/vite-harness-a3f9b2/react.ndjson"
  },
  "channels": ["console", "hmr", "errors"],
  "serverUrl": "http://localhost:5173",
  "mcpUrl": "http://localhost:5173/__mcp/sse",
  "startedAt": 1742654400000,
  "viteVersion": "8.0.0",
  "pluginVersion": "0.1.0"
}
```

---

## 5. Event Schemas

All events share a base shape:
```ts
interface HarnessEvent {
  id: number           // line number = cursor
  ts: number           // Date.now()
  channel: string
  payload: unknown     // channel-specific, see below
}
```

### `console` channel
```ts
{
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  args: string[]        // JSON-serialized, each truncated at 2000 chars
  stack?: string        // error level only
  file?: string         // source location via sourcemap if available
  line?: number
}
```

### `hmr` channel (server-side, no browser relay needed)
```ts
{
  type: 'update' | 'full-reload' | 'error' | 'prune'
  modules?: string[]    // affected module ids
  error?: string        // if type === 'error'
  duration?: number     // ms from file change to HMR completion
}
```

### `errors` channel
Populated automatically from:
- Any `console.error` event
- Unhandled exceptions (`window.addEventListener('error', ...)`)
- Unhandled promise rejections (`unhandledrejection`)
- HMR errors

```ts
{
  type: 'console-error' | 'unhandled-exception' | 'unhandled-rejection' | 'hmr-error'
  message: string
  stack?: string
  file?: string
  line?: number
}
```

### `network` channel (opt-in)
```ts
{
  method: string
  url: string
  status: number
  duration: number      // ms
  requestSize?: number  // bytes
  responseSize?: number // bytes
  initiator: 'fetch' | 'xhr'
}
```
Vite-internal requests (`/__`, `/@`, `/__mcp`) excluded by default.

### `react` channel (opt-in, on-demand)
Written by `get_react_tree` tool calls, not streaming. See §7.

---

## 6. Client Shim Injection

The plugin injects `virtual:vite-harness-client` into the application at dev time.

**Injection mechanism:** The `transform` hook intercepts the project's entry module (detected via `config.build.rollupOptions.input` or defaulting to `index.html`→`main.tsx`). It prepends an import of the virtual module. This guarantees load order — the shim runs before React, which is required for `bippy`.

This is **not** `transformIndexHtml` injection. HTML injection cannot guarantee execution order relative to React. The `transform` hook on the entry module can.

**The shim does:**
1. Patches `console.log/warn/error/info/debug` to relay via `import.meta.hot.send('harness:console', {...})`
2. Registers `window.addEventListener('error', ...)` and `unhandledrejection` handlers
3. If `network: true`: monkey-patches `window.fetch` and `XMLHttpRequest.prototype.open/send`
4. If `react: true`: imports `bippy` and installs fiber hook via `instrument()` before any React import can run

**Production guard:** The shim's first line is `if (!import.meta.hot) { /* no-op */ }`. Vite strips `import.meta.hot` references in production builds, so the entire shim tree-shakes to nothing.

---

## 7. MCP Tools

MCP server embedded at `/__mcp/sse` using `@modelcontextprotocol/sdk` with `SSEServerTransport`.

### Session identity

Each SSE connection gets a UUID session ID assigned by the server on connect. It is returned in the initial MCP `initialize` response metadata and in `get_session_info`. Agents pass it as `session_id` in subsequent tool calls to enable per-agent cursoring if multiple agents connect simultaneously (rare but supported).

---

### `get_session_info`

The first tool Claude Code calls. Returns everything needed to orient and start reading files directly.

```ts
Input: {}

Output: {
  session_id: string
  log_dir: string                          // /tmp/vite-harness-{hash}
  files: Record<string, string>            // channel → absolute file path
  channels_active: string[]
  server_url: string                       // http://localhost:5173
  mcp_url: string                          // http://localhost:5173/__mcp/sse
  started_at: number
  connected_clients: number
  hint: string  // "Use grep/tail/cat on the file paths above. Call get_hmr_status to check HMR state."
}
```

---

### `get_hmr_status`

Lightweight structured poll. Worth a dedicated tool because it's extremely common and the answer would otherwise require parsing NDJSON.

```ts
Input: {
  since?: number    // unix ms, default: session start
}

Output: {
  last_update_at: number | null    // most recent successful HMR
  last_error_at: number | null     // most recent HMR error
  last_error?: string
  update_count: number             // since `since`
  error_count: number              // since `since`
  pending: boolean                 // HMR currently in flight
}
```

---

### `clear_logs`

Truncates channel files. Agent calls this before starting a fix iteration so subsequent file reads only contain new events.

```ts
Input: {
  channels?: string[]   // default: ['console', 'hmr', 'errors', 'network', 'react']
                        // 'all' is also accepted
}

Output: {
  cleared_at: number          // unix ms — use as `since` anchor for file reads
  cleared_at_id: number       // the next event id will be 1 (files truncated)
  files: Record<string, string>  // channel → file path (unchanged, for convenience)
  counts_cleared: Record<string, number>  // events cleared per channel
}
```

---

### `get_react_tree`

On-demand React component tree snapshot via bippy. Only available if `react: true` in plugin options. Writes result to `react.ndjson` as a single event AND returns it directly in the tool response.

```ts
Input: {
  depth?: number              // default: 8, max: 20
  filter_name?: string        // include only components matching this pattern
  include_props?: boolean     // default: true
  include_state?: boolean     // default: false
}

Output: {
  snapshot_at: number
  file: string                // path to react.ndjson (contains this snapshot as last line)
  total_components: number
  tree: ComponentNode[]
}

interface ComponentNode {
  name: string
  depth: number
  props?: Record<string, string>    // values JSON-serialized, truncated at 200 chars
  state?: Record<string, string>    // if include_state: true
  children: ComponentNode[]
}
```

---

## 8. MCP Notifications

Emitted via `notifications/message` on two events:

1. Any event written to the `errors` channel
2. Any HMR event with `type: 'error'`

Payload:
```ts
{
  level: 'error'
  channel: 'errors' | 'hmr'
  message: string      // human-readable summary
  file: string         // absolute path to the relevant log file
  hint: string         // e.g. "tail -5 /tmp/vite-harness-a3f9b2/errors.ndjson"
}
```

The `hint` field gives Claude Code a ready-made shell command to read the relevant context. Agents that don't support notifications get events on next poll. Delivery is fire-and-forget.

---

## 9. Plugin Options

```ts
interface ViteLiveDevMcpOptions {

  // MCP server path (default: '/__mcp')
  mcpPath?: string

  // Opt-in channels
  network?: boolean                   // default: false
  react?: boolean                     // default: false

  // Network channel options
  networkOptions?: {
    excludePatterns?: string[]        // URL substrings to exclude
                                      // default: ['/__', '/@', '/node_modules']
    captureRequestBody?: boolean      // default: false
    captureResponseBody?: boolean     // default: false
  }

  // React channel options
  // react: true enables on-demand get_react_tree snapshots
  // reactOptions.mode: 'commit' additionally streams commit events to react.ndjson
  reactOptions?: {
    mode?: 'on-demand' | 'commit'     // default: 'on-demand'
    maxDepth?: number                 // default: 8
    includeProps?: boolean            // default: true
    includeState?: boolean            // default: false
    excludeComponents?: string[]      // component name patterns to exclude
    // commit mode additional options:
    commitThrottleMs?: number         // min ms between commit writes, default: 200
    commitMaxEventsPerMin?: number    // rate limit, default: 300
  }

  // Tmp file options
  logDir?: string                     // override tmp dir location
                                      // default: /tmp/vite-harness-{projectHash}
  maxFileSizeMb?: number              // per channel, triggers rotation, default: 10

  // Agent config auto-registration
  autoRegister?: boolean | {
    claude?: boolean                  // .claude/mcp.json
    cursor?: boolean                  // .cursor/mcp.json  
    windsurf?: boolean                // .windsurf/mcp.json
  }                                   // default: true

  // MCP error notifications
  notifications?: boolean             // default: true

  // Print MCP URL and log dir to console on start
  printUrl?: boolean                  // default: true
}
```

---

## 10. Auto-Registration

On dev server start, the plugin reads `server.resolvedUrls.local[0]` for the absolute URL (handles any host binding, custom ports, etc.) and writes:

```json
{
  "mcpServers": {
    "vite-live-dev-mcp": {
      "url": "http://localhost:5173/__mcp/sse"
    }
  }
}
```

To each detected config file. Existing keys in those files are preserved. The `vite-live-dev-mcp` key is upserted.

---

## 11. Installation

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
      network: true,
      react: true,
    }),
  ],
})
```

On `vite dev`:
```
  ➜  vite-live-dev-mcp: http://localhost:5173/__mcp/sse
  ➜  log dir: /tmp/vite-harness-a3f9b2
  ➜  auto-registered: .claude/mcp.json
```

---

## 12. Agent Usage Pattern

The intended Claude Code workflow for a frontend fix loop:

```
# Session start (once)
get_session_info
→ note log_dir, file paths

# Before starting a task
clear_logs
→ note cleared_at timestamp

# Make code changes — HMR fires automatically

# Check if change landed
get_hmr_status({ since: cleared_at })
→ any errors? pending?

# Check runtime errors
cat /tmp/vite-harness-a3f9b2/errors.ndjson

# Check console output
grep "test-" /tmp/vite-harness-a3f9b2/console.ndjson | tail -20

# Check React tree if needed
get_react_tree({ filter_name: "Checkout" })

# If something wrong: read errors, edit, wait for HMR, repeat
```

For screenshot and interaction: use `agent-browser` or `chrome-devtools-mcp` alongside this plugin. This plugin is observation only in v1.

---

## 13. Relationship to Existing Tools

| Tool | Relationship |
|---|---|
| `blowback` | Most similar in intent. Key differences: blowback runs as a separate stdio process using Puppeteer; this plugin is embedded in Vite using native channels. Blowback uses SQLite; this plugin uses tmp files. Design reference, not a dependency. |
| `vite-plugin-mcp` (antfu) | Source of the `/__mcp/sse` embedded MCP pattern. Architecture template. |
| `vite-plugin-mcp-client-tools` (atesgoral) | Most similar architecture (embedded Vite + hot relay). This plugin is a superset: adds HMR tracking, file persistence, React adapter, network logging, auto-registration. |
| `vite-react-mcp` | Source of the bippy + Vite WebSocket relay pattern for React fiber access. Reference implementation, not a dependency. |
| `agent-browser` (vercel-labs) | Complementary. Handles screenshots and browser interaction. This plugin handles telemetry. |
| `chrome-devtools-mcp` | Complementary. Handles network waterfall, perf traces, DOM inspection. This plugin handles app-level events. |

---

## 14. Package Structure

```
vite-live-dev-mcp/
  src/
    index.ts              ← plugin entry, exports viteLiveDevMcp()
    plugin.ts             ← Vite plugin hooks (configureServer, transform, etc.)
    mcp-server.ts         ← MCP server, tool definitions, SSE transport
    writers/
      console.ts          ← console event writer
      hmr.ts              ← HMR event writer (server-side)
      errors.ts           ← errors channel writer
      network.ts          ← network event writer
    client/
      harness-client.ts   ← browser shim (virtual module)
      react-adapter.ts    ← bippy integration (only loaded if react: true)
    session.ts            ← session ID, log dir, session.json management
    auto-register.ts      ← agent config file writer
  test/
    unit/                 ← Vitest, no Vite needed
    integration/          ← Vitest, uses Vite createServer API
  package.json
  tsconfig.json

test-app/                 ← fixture project for E2E
  src/
    App.tsx
    components/Counter.tsx
  vite.config.ts
  test/
    e2e/                  ← Playwright
  AGENTS.md
```

---

## 15. Test Plan

### Unit tests (Vitest, `test/unit/`) — no browser, fast

| Test | What it catches |
|---|---|
| File truncated on session init | stale events from previous session |
| Event written to correct channel file | wrong channel routing |
| `id` increments monotonically per session | cursor math breaks |
| Rotation triggers at `maxFileSizeMb` | file grows unbounded |
| `clear_logs` truncates files, returns `cleared_at` | anchor timestamp missing |
| Network events excluded for `/__mcp` URLs | Vite-internal noise in logs |

### Integration tests (Vitest, `test/integration/`) — Vite programmatic API

| Test | What it catches |
|---|---|
| `createServer` with plugin → `GET /__mcp/sse` returns 200 | MCP server not mounting |
| `GET /__mcp/sse` returns correct MCP capability handshake | wrong protocol / missing tools |
| `session.json` written on server start with correct `serverUrl` | auto-registration uses wrong URL |
| `.claude/mcp.json` written with correct MCP URL | auto-registration broken |
| Entry module `transform` output contains `virtual:vite-harness-client` import | shim not injecting |
| `server.forwardConsole` is `false` when plugin active | duplicate terminal output |

### E2E tests (Playwright, `test-app/test/e2e/`) — real browser, real dev server

Each test: start dev server → open headless browser → trigger event → assert file content OR call MCP tool endpoint directly via HTTP.

| Test | Trigger | Assert |
|---|---|---|
| Console error captured | click "Throw Error" button | `errors.ndjson` contains `test-error-marker` |
| Console log captured | click "Log Message" button | `console.ndjson` contains `test-log-marker` |
| Unhandled rejection captured | click "Reject Promise" button | `errors.ndjson` contains `type: unhandled-rejection` |
| HMR update captured | `fs.writeFile` adds comment to source file | `hmr.ndjson` contains `type: update`, `get_hmr_status` returns `last_update_at` |
| `clear_logs` resets files | write events, call tool, check files | files empty, `cleared_at` > 0 |
| React tree returns component names | page load, call `get_react_tree` | response contains `Counter` and `App` |
| `get_session_info` returns valid file paths | cold start, call tool | all returned paths exist on disk |

### Test app (`test-app/src/App.tsx`) — minimal, instrumented

```tsx
export default function App() {
  return (
    <div>
      <Counter />
      <button onClick={() => console.error('test-error-marker')}>
        Throw Error
      </button>
      <button onClick={() => console.log('test-log-marker')}>
        Log Message
      </button>
      <button onClick={() => {
        Promise.reject(new Error('test-rejection-marker'))
      }}>
        Reject Promise
      </button>
      <button onClick={() => fetch('/test-fetch-endpoint')}>
        Fetch
      </button>
    </div>
  )
}
```

All trigger strings (`test-error-marker` etc.) are unique and greppable. Tests assert by grepping file content — no JSON parsing required.

### `test-app/AGENTS.md`

```markdown
## Running tests

Full automated suite (no human required):
  cd ../vite-live-dev-mcp && npx vitest run
  npx playwright test

What to check if E2E fails:
1. Is the dev server running? Check port 5174 (test port).
2. Is the shim injecting? View page source, look for virtual:vite-harness-client.
3. Are files being written? ls -la /tmp/vite-harness-*/
4. Is MCP responding? curl http://localhost:5174/__mcp/sse

Manual smoke test (only if automated suite passes but something feels wrong):
  npm run dev
  # In another terminal:
  curl -s http://localhost:5173/__mcp/sse &
  # Then call get_session_info and grep the returned log files
```

---

## 16. Deferred to v2

- **`eval_in_browser(code, target?)`** — push arbitrary JS to a specific browser client and return the result. `target` is either `'all'` (broadcast) or a session ID for a specific connected client. Transport upgrade: replace `import.meta.hot.send` one-way relay with **Cap'n Web** (`cloudflare/capnweb`) over the same WebSocket for bidirectional typed RPC. The server holds a Cap'n Web stub per connected browser client; calling `stub.eval(code)` invokes the browser shim and returns the result.

- **`attach_listener(selector, event)` / `detach_listener(id)`** — register DOM event listeners from the agent, stream events back via Cap'n Web callback stubs.

- **`window.__harness` app API** — a first-class instrumentation surface the app itself can use (`window.__harness.emit('custom-event', data)`), distinct from console interception. Events routed to a `custom` channel file.

- **WebMCP integration** — `navigator.modelContext` (Chrome 146+ behind flag, W3C draft). The app can expose structured tools to browser-based agents via `navigator.modelContext.provideContext()`. Vite plugin could auto-generate WebMCP tool definitions from the harness API surface.

- **`npx vite-live-dev-mcp`** — zero-touch wrapper that starts Vite with the plugin injected, no `vite.config.ts` changes needed.

- **Vue / Svelte adapters** — framework hooks follow the same pattern as the React adapter.

---

## 17. Open Questions (resolved)

| Question | Decision |
|---|---|
| In-memory ring buffer vs files | Files in `/tmp`. Ring buffer dropped. |
| TTL-based vs size-based eviction | Size-based rotation at `maxFileSizeMb` |
| Streaming MCP vs file paths | File paths. MCP tools are for orientation and structured queries only. |
| Multi-agent cursors | Agent uses line numbers as cursors natively via shell tools. No cursor API. |
| Auto-registration URL | `server.resolvedUrls.local[0]` — Vite knows the actual bound address. |
| React channel default mode | `on-demand` (snapshot only). `commit` streaming is opt-in. |
| `forwardConsole` conflict | Plugin sets it to `false` internally when active. |
| Session ID | UUID assigned on SSE connect, returned in `get_session_info`. |
| bippy injection | Via `transform` hook on entry module, not `transformIndexHtml`. |
| `clear_logs` ID reset | Resets to 1 (files truncated), returns `cleared_at` timestamp. |
| Single vs multi package | Single package. React adapter gated by `react: true` option. |