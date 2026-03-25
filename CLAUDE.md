# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vite plugin that gives AI agents live observability into running apps during development. Exposes console logs, HMR events, network requests, DOM queries, and JS evaluation via MCP tools and NDJSON log files.

Three communication channels:
1. **HMR WebSocket** (`import.meta.hot`) - browser pushes events to server → NDJSON files
2. **capnweb RPC WebSocket** (`/__rpc`) - bidirectional object-capability RPC for eval/DOM queries
3. **CDP WebSocket** (`/__cdp`) - Chrome DevTools Protocol for Playwright `connectOverCDP`

## Commands

### Build & Test
```bash
npm run build           # TypeScript compilation to dist/
npm test               # Run vitest tests
```

### Development with test-app
```bash
cd test-app
npm run dev            # Start dev server with plugin active
                       # Uses portless → http://test-app.localhost

# In another terminal:
node scripts/test-cdp.mjs            # Test CDP/Playwright connection
node scripts/test-cdp.mjs http://test-app.localhost/__cdp
```

The test-app uses the local plugin via `file:..` dependency. After changing plugin source, rebuild with `npm run build` for test-app to pick up changes.

### MCP Testing
The plugin starts an MCP server at `/__mcp/sse` when dev server runs. Tools available:
- `get_session_info` - Returns log paths, server URL
- `get_diagnostics` - Consolidated logs + HMR + summary (use this for test/fix loops)
- `get_hmr_status` - HMR state check
- `clear_logs` - Truncate logs, sets checkpoint for `since_checkpoint` filtering
- `eval_in_browser` - Run JS in browser via capnweb RPC
- `query_dom` - Query DOM with configurable depth/attributes
- `wait_for_condition` - Server-side polling until JS expression is truthy
- `get_react_tree` - React component tree (if `react: true` + bippy)

## Architecture

### Virtual Module Injection
Plugin injects `virtual:vite-harness-client` into app entry points by intercepting files with `createRoot`/`ReactDOM.render`/`hydrateRoot`. The virtual module:
- Patches `console.*` methods
- Registers `error` and `unhandledrejection` handlers
- Monkey-patches `fetch`/`XMLHttpRequest` (if `network: true`)
- Installs bippy React fiber hook (if `react: true`)
- Relays events via `import.meta.hot.send('harness:*', payload)`

All client code is in [src/client/](src/client/) and loaded as virtual modules (`\0virtual:*` in Vite's module graph).

### Log Files
On dev server start, creates `.vite-mcp/` in the project root:
- `session.json` - Session metadata (file paths, server URL, MCP URL)
- `console.ndjson` - Console logs
- `hmr.ndjson` - HMR updates/errors
- `errors.ndjson` - Subset: errors + unhandled exceptions
- `network.ndjson` - fetch/XHR (opt-in)

Files truncated on each dev server start. `{hash}` = first 6 chars of SHA-256 of project root (stable across restarts).

NDJSON format: `{"id":1,"ts":1742654400123,"channel":"console","payload":{...}}`
- `id` = line number (monotonic per session, resets to 1 on truncate)
- `ts` = Date.now()

### Writers
[src/writers/](src/writers/) - Each channel has a writer class:
- `ConsoleWriter`, `HmrWriter`, `ErrorsWriter`: `fs.appendFileSync` (synchronous)
- `NetworkWriter`: Buffered 100ms, then flushed
- File rotation at `maxFileSizeMb` (default 10MB) → `.ndjson.1`

`HmrWriter` tracks status in-memory for fast `get_hmr_status` polling.

### RPC Server (capnweb)
[src/rpc-server.ts](src/rpc-server.ts) - WebSocket at `/__rpc`:
- Browser connects on page load
- Server holds `RpcStub<BrowserStub>` per connection
- Calling `stub.eval(expr)` or `stub.queryDom(sel, opts)` → ~3ms round-trip
- Powers `eval_in_browser` and `query_dom` MCP tools (fallback to HMR relay if RPC unavailable)
- `getBrowserStub()` returns latest connected browser

Browser exports interface defined in [src/client/rpc-browser.ts](src/client/rpc-browser.ts).

### CDP Server (Chrome DevTools Protocol)
[src/cdp-server.ts](src/cdp-server.ts) - Proxies CDP to browser via capnweb + Chobitsu:
- `/__cdp/json/version` - Browser version
- `/__cdp/json` - List of connected pages
- `/__cdp/devtools/browser` - WebSocket for latest browser
- `/__cdp/devtools/page/:id` - WebSocket for specific browser

Enables Playwright `connectOverCDP()` without launching a separate browser:
```js
const browser = await chromium.connectOverCDP('http://localhost:5173/__cdp')
const page = browser.contexts()[0].pages()[0]
```

### MCP Server
[src/mcp-server.ts](src/mcp-server.ts) - SSE transport at `/__mcp/sse`:
- Uses `@modelcontextprotocol/sdk`
- Tools defined inline with zod schemas
- `get_diagnostics` - Main optimization: single call replaces 4-5 separate `get_logs()` calls
- `wait_for_condition` - Server-side polling eliminates agent polling loops
- Notifications for errors/HMR failures (fire-and-forget)

Connection map (`sessionId → {transport, server}`) enables multi-agent support.

### Plugin Hooks
[src/plugin.ts](src/plugin.ts):
- `configResolved`: Sets `forwardConsole: false` (plugin handles console output)
- `configureServer`: Registers MCP + CDP middleware, sets up RPC WebSocket
- `httpServer.once('listening')`: Inits session + writers (needs `resolvedUrls` for server URL)
- `hotUpdate`: Writes HMR update events
- `resolveId` + `load`: Serves virtual modules
- `transform`: Injects virtual module import into files with `createRoot`/etc

Writers listen to `server.hot.on('harness:*')` events from browser.

### Session Management
[src/session.ts](src/session.ts):
- `computeSessionId(projectRoot)` - SHA-256 hash → 6 chars
- `initSession()` - Creates log dir, truncates files, writes session.json
- `truncateChannelFiles()` - Called by `clear_logs` tool
- `checkpointTs` - Set by `clear_logs`, used by `get_diagnostics({since_checkpoint: true})`

### Log Reader
[src/log-reader.ts](src/log-reader.ts):
- `queryLogs()` - Reads NDJSON files with filtering (level, search, since_id, limit)
- `getDiagnostics()` - Consolidated endpoint that reads all channels + HMR status
- Summary calculation: counts errors, warnings, failed requests, unhandled rejections

## Development Workflow

### Adding a new MCP tool
1. Add tool definition to [src/mcp-server.ts](src/mcp-server.ts) using `mcp.tool(name, description, schema, handler)`
2. If tool needs browser data, either:
   - Read from NDJSON files via `queryLogs()`
   - Call `getBrowserStub()` and use capnweb RPC
   - Use `relayToBrowser()` for HMR channel relay (fallback)

### Adding a new event channel
1. Create writer in [src/writers/](src/writers/) extending `BaseWriter`
2. Add channel to plugin options in [src/types.ts](src/types.ts)
3. Initialize writer in [src/plugin.ts](src/plugin.ts) `configureServer` hook
4. Add client-side event emitter to [src/client/harness-client.ts](src/client/harness-client.ts)
5. Register listener in plugin: `server.hot.on('harness:newchannel', handler)`

### Testing changes
1. Build plugin: `npm run build` (or `npm run dev` for watch mode)
2. Start test-app: `cd test-app && npm run dev`
3. Open browser to test-app URL (printed in console)
4. Check logs: `ls -la test-app/.vite-mcp/` and `tail -f test-app/.vite-mcp/console.ndjson`
5. Test MCP tools via Claude Code or direct HTTP:
   ```bash
   curl http://test-app.localhost/__mcp/sse
   ```

### CDP/Playwright testing
1. Start test-app dev server
2. Open browser to app (CDP needs active page)
3. Run `node scripts/test-cdp.mjs` (defaults to localhost:5173)
4. Script connects via Playwright, evaluates JS, verifies connection

## Key Files

- [src/plugin.ts](src/plugin.ts) - Main plugin, Vite hooks, middleware registration
- [src/mcp-server.ts](src/mcp-server.ts) - MCP tools, SSE transport, notifications
- [src/rpc-server.ts](src/rpc-server.ts) - capnweb WebSocket, browser stub management
- [src/cdp-server.ts](src/cdp-server.ts) - CDP WebSocket proxy to Chobitsu
- [src/client/harness-client.ts](src/client/harness-client.ts) - Browser shim (virtual module)
- [src/client/rpc-browser.ts](src/client/rpc-browser.ts) - Browser-side RPC interface
- [src/session.ts](src/session.ts) - Session ID, log dir, file management
- [src/log-reader.ts](src/log-reader.ts) - NDJSON parsing, filtering, diagnostics
- [src/types.ts](src/types.ts) - TypeScript interfaces for all payloads

## Important Implementation Details

### Checkpoint system
`clear_logs()` sets `session.checkpointTs = Date.now()`.
`get_diagnostics({ since_checkpoint: true })` filters events where `event.ts >= checkpointTs`.
This enables "show me only new events since last clear" without managing cursor state.

### Browser connection lifecycle
- Browser connects to `/__rpc` on page load
- Server creates `RpcSession`, stores stub in `browsers` Map
- Server calls `stub.id` to get sticky browser ID (async)
- On WebSocket close, removes from `browsers` and `connectionOrder`
- `getBrowserStub()` returns latest connected browser (for single-tab dev)

### CDP implementation
CDP WebSocket messages from Playwright → [src/cdp-server.ts](src/cdp-server.ts) → capnweb RPC → Chobitsu in browser.
Chobitsu implements CDP in JS. Not full Chrome DevTools, but enough for Playwright `page.evaluate()`, `page.click()`, etc.

### Virtual module resolution
Vite's `resolveId` returns `\0virtual:...` (null byte prefix = internal module).
`load` hook serves source for `\0virtual:...` IDs by reading from `src/client/` at runtime.
This avoids bundling client code into the plugin - keeps it hot-reloadable during plugin dev.

## Common Gotchas

- After changing plugin code, must run `npm run build` for test-app to pick up changes (unless using `npm run dev` watch mode)
- If MCP tools return "no browser connected", open test-app in browser first (RPC requires active connection)
- If HMR not firing, check `server.forwardConsole` isn't being overridden elsewhere in config
- If logs empty, check `.vite-mcp/session.json` exists (session may not have initialized)
- CDP requires browser to be open before Playwright connects (`/__cdp/json` returns empty array if no pages)
