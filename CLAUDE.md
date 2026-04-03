# CLAUDE.md

## Build

```bash
npm run build          # all 3 packages (gateway, adapter-vite, adapter-nextjs)
```

After changing source, rebuild before testing examples.

## Monorepo layout

- `packages/gateway/` — Core gateway (`@winstonfassett/web-dev-mcp-gateway`). Has its own [CLAUDE.md](packages/gateway/CLAUDE.md).
- `packages/adapter-vite/` — Vite plugin + Storybook preset (`@winstonfassett/web-dev-mcp-vite`).
- `packages/adapter-nextjs/` — Next.js adapter (`@winstonfassett/web-dev-mcp-nextjs`).
- `packages/proxy/` — Dynamic proxy plugin (not published yet).
- `examples/vite-app/` — Vite test app
- `examples/nextjs-turbopack/` — Next.js turbopack test app
- `examples/nextjs-webpack/` — Next.js webpack test app
- `examples/storybook-app/` — Storybook test app
- `examples/admin-svelte/` — Admin UI (builds into gateway dist)

## Non-obvious things

- Gateway CLI is `npx web-dev-mcp` (bin name, not package name).
- Adapters auto-start the gateway if it's not running. PID written to `/tmp/web-dev-mcp-*.pid`.
- MCP core toolset (6 tools) is at `/__mcp/sse`. Full set (23 tools) at `/__mcp/sse?tools=full`.
- `eval_js` runs JS directly in the browser. `document`/`window` are real browser objects. Promises are auto-awaited.
- `eval_js` accepts `string | string[]`. Array = auto-waited pipeline (DOM settles between steps).
- `eval_js` has `browser.*` helpers and persistent `state` object (browser-side, per session).
- CDP/chobitsu was removed. No CDP endpoint exists anymore.
- After `navigate()`, browser reconnects — wait ~2-3s before next tool call. SPA route changes via `click` don't disconnect.
- Gateway `web-dev-mcp-client.js` (~60KB minified) is a bundled browser script injected into pages. Built by `build-client.mjs` using esbuild. Served at `/__web-dev-mcp.js`.

## npm Publishing

```bash
npm run prepublish:check   # build + dry-run all packages
npm run publish:all        # publish gateway → vite → nextjs (in order)
```

Packages: `@winstonfassett/web-dev-mcp-gateway`, `@winstonfassett/web-dev-mcp-vite`, `@winstonfassett/web-dev-mcp-nextjs`.
