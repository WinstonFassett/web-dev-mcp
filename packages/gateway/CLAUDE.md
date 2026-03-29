# @winstonfassett/web-dev-mcp-gateway

Universal gateway — proxy, MCP server, capnweb routing between agents and browsers.
Framework adapters are in separate packages (`adapter-vite`, `adapter-nextjs`).
Shared adapter helpers exported at `./helpers` subpath.

## Build

```bash
npm run build   # tsc && node build-client.mjs
```

`build-client.mjs` bundles `src/client/index.ts` into `dist/client.js` (~60KB minified) using esbuild. This is the browser script injected into proxied pages.

## Non-obvious

- MCP tools split into `mcp-tools-core.ts` (3 tools) and `mcp-tools-full.ts` (23 tools). Selected by `?tools=` query param on SSE URL.
- `eval_js_rpc` uses `AsyncFunction` (not `vm.runInContext`) to avoid cross-realm serialization issues with capnweb stubs.
- `eval_js_rpc` has persistent `state` object per MCP session (`sessionStates` Map in mcp-tools-core.ts, cleaned up on SSE disconnect in mcp-server.ts). Holds capnweb proxy refs across calls.
- `rpc-server.ts` has two WebSocket endpoints: `/__rpc` (browsers connect, server gets stubs) and `/__rpc/agent` (agents connect, server gives them browser stubs via `GatewayApi`).
- `GatewayApi` in `rpc-server.ts` bridges agent→browser by returning the browser stub's `document`/`window`. capnweb handles cross-session proxy automatically.
- Dynamic proxy: URLs like `/https://example.com/page` are proxied with `<base>` tag injection for relative assets. Uses `secure: false` for HTTPS targets.
- `src/client/index.ts` is the browser-side client. It has its own `BrowserApi` class with `findElement` (text= support), `getPageMarkdown`, `navigate`, etc. Changes here require `npm run build` (esbuild rebundle).
