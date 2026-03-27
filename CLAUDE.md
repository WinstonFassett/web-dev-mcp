# CLAUDE.md

## Build

```bash
npm run build          # both packages
```

After changing plugin source, rebuild before testing examples.

## Monorepo layout

- `packages/vite-plugin/` — Vite plugin (`vite-live-dev-mcp`). Has its own [CLAUDE.md](packages/vite-plugin/CLAUDE.md).
- `packages/gateway/` — Gateway (`web-dev-mcp-gateway`). Has its own [CLAUDE.md](packages/gateway/CLAUDE.md).
- `examples/vite-app/` — test app (uses vite plugin via `file:..`)
- `examples/nextjs-app/` — test app (uses gateway via `file:..`)

## Non-obvious things

- `packages/vite-plugin/client/` files are virtual modules loaded at runtime by Vite — they are NOT compiled by tsc. tsconfig excludes them. They must be valid JS (no TS syntax).
- Gateway CLI is `npx web-dev-mcp-gateway`, not `npx web-dev-mcp`.
- MCP core toolset (3 tools) is at `/__mcp/sse`. Legacy full set (23 tools) at `/__mcp/sse?tools=full`.
- `eval_capnweb` runs JS on the server, not in the browser. `document`/`window` are capnweb remote proxies. Each property access is an RPC call.
- `eval_capnweb` is stateless per call. Has `browser.*` helpers (markdown, screenshot, navigate, click, fill, waitFor). Re-query DOM each call.
- CDP/chobitsu was removed. No CDP endpoint exists anymore.
- After `navigate()`, browser RPC reconnects — wait ~2-3s before next tool call. SPA route changes via `click` don't disconnect.
- Gateway `client.js` (~540KB) is a bundled browser script injected into pages. Built by `build-client.mjs` using esbuild.
