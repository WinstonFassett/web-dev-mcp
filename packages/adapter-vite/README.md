# @winstonfassett/web-dev-mcp-vite

Vite plugin for [web-dev-mcp](https://github.com/WinstonFassett/web-dev-mcp) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/web-dev-mcp-vite @winstonfassett/web-dev-mcp-gateway
```

## Vite

```ts
// vite.config.ts
import { webDevMcp } from '@winstonfassett/web-dev-mcp-vite'

export default defineConfig({
  plugins: [webDevMcp()],
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## Storybook

```ts
// .storybook/main.ts
export default {
  addons: ['@winstonfassett/web-dev-mcp-vite/storybook'],
}
```

## Options

```ts
webDevMcp({
  gateway: 'http://localhost:3333',  // Gateway URL (default)
  serverType: 'vite',                // 'vite' | 'storybook' | 'generic'
})
```

## License

MIT
