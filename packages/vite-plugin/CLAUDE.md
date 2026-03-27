# vite-live-dev-mcp

Vite plugin with embedded MCP server. Injects browser instrumentation via virtual modules.

## Build

```bash
npm run build   # tsc
```

## Non-obvious

- `client/` contains virtual modules (harness-client.ts, rpc-browser.ts, react-adapter.ts). These are read at runtime by `plugin.ts` and served as Vite virtual modules. They are NOT compiled by tsc — tsconfig excludes `client/`.
- `plugin.ts:getClientShimSource()` reads client files from `../client/` relative to `dist/`. If the path breaks after a reorg, the virtual module returns a 500 error.
- Virtual module injection: `plugin.ts` transforms files containing `createRoot`/`ReactDOM.render`/`hydrateRoot` to prepend `import "virtual:vite-harness-client"`.
- The MCP server in this package has the full 23-tool set (standalone mode). The gateway's core/full split is gateway-only.
- `findElement(selector)` in the browser clients supports `text=` prefix for text-based element matching. Used by click, fill, hover.
