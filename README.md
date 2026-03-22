# vite-live-dev-mcp

Vite plugin that gives AI coding agents live observability into a running React app during development — console logs, HMR events, network requests, and React component state — via structured NDJSON files and an embedded MCP server.

## Quick Start

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
      // react: true,   // opt-in: enable get_react_tree (requires bippy)
    }),
  ],
})
```

Start the dev server:

```
$ npx vite

  ➜  vite-live-dev-mcp: http://localhost:5173/__mcp/sse
  ➜  log dir: /tmp/vite-harness-a3f9b2
  ➜  auto-registered: .claude/mcp.json
```

That's it. Claude Code (and Cursor, Windsurf) will auto-discover the MCP server.

## How It Works

```
Browser (client shim)               Vite Dev Server
  console.log("hello")  ──hot──▶   writes to /tmp/vite-harness-*/console.ndjson
  window error           ──hot──▶   writes to /tmp/vite-harness-*/errors.ndjson
  fetch("/api/users")    ──hot──▶   writes to /tmp/vite-harness-*/network.ndjson
                                    HMR events ──▶ /tmp/vite-harness-*/hmr.ndjson

AI Agent (Claude Code)
  MCP tool: get_session_info  →  returns file paths
  shell:    tail -5 /tmp/vite-harness-*/errors.ndjson
  MCP tool: get_hmr_status    →  { update_count: 3, error_count: 0 }
  MCP tool: clear_logs        →  truncate files, start fresh
```

**Files are the interface.** The MCP server orients the agent and provides structured queries. Log data lives in NDJSON files. The agent uses `grep`, `tail`, `cat` directly.

## MCP Tools

| Tool | Purpose |
|---|---|
| `get_session_info` | Returns log dir, file paths, server URL. Call first. |
| `get_hmr_status` | HMR update/error counts, pending state. Lightweight poll. |
| `clear_logs` | Truncate log files. Call before a fix iteration. |
| `get_react_tree` | On-demand React component tree snapshot (requires `react: true` + `bippy`). |

## Agent Workflow

```
# 1. Orient (once per session)
get_session_info → note file paths

# 2. Before starting a task
clear_logs → clean slate

# 3. Make code changes (HMR fires automatically)

# 4. Check results
get_hmr_status → any errors?
cat /tmp/vite-harness-*/errors.ndjson
grep "test-" /tmp/vite-harness-*/console.ndjson | tail -20

# 5. If broken: read errors, fix, repeat
```

## NDJSON File Format

One JSON object per line. `id` = line number = cursor.

```json
{"id":1,"ts":1742654400123,"channel":"console","payload":{"level":"error","args":["something broke"],"file":"src/App.tsx","line":12}}
{"id":2,"ts":1742654400456,"channel":"console","payload":{"level":"log","args":["counter: 5"]}}
```

An agent can do `sed -n '47,$p' console.ndjson` to read from event 47 onward.

## Options

```ts
viteLiveDevMcp({
  mcpPath: '/__mcp',            // MCP server path (default: '/__mcp')
  network: false,                // log fetch/XHR (default: false)
  react: false,                  // enable get_react_tree (default: false)
  networkOptions: {
    excludePatterns: ['/__', '/@', '/node_modules'],  // URL patterns to skip
  },
  logDir: undefined,             // override tmp dir (default: /tmp/vite-harness-{hash})
  maxFileSizeMb: 10,             // per-channel rotation threshold
  autoRegister: true,            // write .claude/mcp.json etc (default: true)
  notifications: true,           // MCP notifications for errors (default: true)
  printUrl: true,                // print MCP URL on startup (default: true)
})
```

## React Tree (opt-in)

```bash
npm install -D bippy
```

```ts
viteLiveDevMcp({ react: true })
```

The `get_react_tree` tool returns an on-demand component tree snapshot:

```json
{
  "snapshot_at": 1742654400123,
  "total_components": 5,
  "tree": [
    { "name": "App", "depth": 0, "props": {}, "children": [...] },
    { "name": "Counter", "depth": 1, "props": { "initial": "0" }, "children": [] }
  ]
}
```

## Requirements

- Vite 6+
- Node 20.19+
- React 17–19 (for `react: true` with bippy)

## Tmp File Layout

```
/tmp/vite-harness-{hash}/
  session.json          ← session metadata
  console.ndjson        ← always active
  hmr.ndjson            ← always active
  errors.ndjson         ← always active
  network.ndjson        ← opt-in (network: true)
  react.ndjson          ← opt-in (react: true)
```

`{hash}` is derived from the project root path — stable across restarts.

## License

MIT
