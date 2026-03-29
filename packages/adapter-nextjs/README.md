# @winstonfassett/web-dev-mcp-nextjs

Next.js adapter for [web-dev-mcp](https://github.com/WinstonFassett/web-dev-mcp) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/web-dev-mcp-nextjs @winstonfassett/web-dev-mcp-gateway
```

## Webpack mode (Next.js 14+)

Fully automatic — client instrumentation is injected via webpack entry.

```js
// next.config.js
import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'

export default withWebDevMcp({
  // your Next.js config
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## Turbopack mode (Next.js 15+)

Turbopack doesn't support webpack entry injection, so add the client component to your layout:

```js
// next.config.js
import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'

export default withWebDevMcp({
  turbopack: {},
})
```

```tsx
// app/layout.tsx
import { WebDevMcpInit } from '@winstonfassett/web-dev-mcp-nextjs/init'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <WebDevMcpInit />
        {children}
      </body>
    </html>
  )
}
```

## Options

```js
withWebDevMcp(nextConfig, {
  gatewayUrl: 'http://localhost:3333',  // Gateway URL (default)
  enabled: process.env.NODE_ENV === 'development',  // Default
})
```

## License

MIT
