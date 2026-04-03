# @winstonfassett/web-dev-mcp-gateway

Universal gateway — MCP server + JSON command routing between agents and browsers.
Framework adapters are in separate packages (`adapter-vite`, `adapter-nextjs`).
Shared adapter helpers exported at `./helpers` subpath.

## Build

```bash
npm run build   # tsc && node build-client.mjs
```

`build-client.mjs` bundles `src/client/index.ts` into `dist/web-dev-mcp-client.js` (~60KB minified) using esbuild. This is the browser script injected into pages, served at `/__web-dev-mcp.js`.

## Non-obvious

- MCP tools split into `mcp-tools-core.ts` (6 tools) and `mcp-tools-full.ts` (23 tools). Selected by `?tools=` query param on SSE URL.
- `eval_js` sends code to the browser for execution via JSON command WebSocket. `document`/`window` are real browser objects, not proxies.
- `eval_js` accepts `string | string[]`. Array = steps with DOM settle between each (MutationObserver quiet period). Promises auto-awaited.
- `state` object persists across eval calls within a browser session (browser-side). Holds refs to DOM elements, framework stores, etc. Dies on page reload.
- `rpc-server.ts` has one WebSocket endpoint: `/__rpc` (browsers connect, gateway sends JSON commands).
- Browser commands: `{ id, method, params }` → `{ id, result }` or `{ id, error }`. Methods: eval, screenshot, click, fill, navigate, queryDom, getPageMarkdown, etc.
- Dynamic proxy: URLs like `/https://example.com/page` are proxied with `<base>` tag injection for relative assets. Uses `secure: false` for HTTPS targets.
- `src/client/index.ts` is the browser-side client. It has `findElement` (text= support), `getPageMarkdown`, `navigate`, screenshot (via modern-screenshot), etc. Changes here require `npm run build` (esbuild rebundle).
