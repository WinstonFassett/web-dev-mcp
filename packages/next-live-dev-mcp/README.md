# next-live-dev-mcp

AI agent observability for Next.js apps via MCP tools. Provides live console logs, error tracking, and browser interaction during development.

## Features (Wave 1)

- ✅ **Console Logging**: Capture all browser console logs (log, warn, error, info, debug)
- ✅ **Bidirectional RPC**: Uses capnweb for browser ↔ server communication
- ✅ **MCP Integration**: Read logs via MCP tools (`get_diagnostics`, `get_session_info`)
- ✅ **Turbopack Support**: Works with Next.js 16+ default bundler
- ✅ **Custom Server**: Independent server lifecycle for reliable connections

## Installation

```bash
npm install next-live-dev-mcp
```

## Usage

### 1. Create Custom Server

Create `server.js`:

```javascript
import { createMcpServer } from 'next-live-dev-mcp'
import next from 'next'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev, hostname: 'localhost', port: 3000 })

app.prepare().then(() => {
  const server = createMcpServer(app, {
    network: false,      // Enable network request tracking (Wave 3)
    printUrl: true,      // Print MCP/RPC URLs on startup
  })

  server.listen(3000, () => {
    console.log('> Ready on http://localhost:3000')
  })
})
```

### 2. Update next.config.js

```javascript
import { withNextMcp } from 'next-live-dev-mcp'

const nextConfig = {
  // Your Next.js config
}

export default withNextMcp(nextConfig)
```

### 3. Import Client in Layout

Add to `app/layout.tsx`:

```typescript
import 'next-live-dev-mcp/client'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

### 4. Update package.json Scripts

```json
{
  "scripts": {
    "dev": "node server.js",
    "build": "next build",
    "start": "node server.js"
  }
}
```

### 5. Run Development Server

```bash
npm run dev
```

## MCP Tools

Once running, these MCP tools are available:

- **`get_session_info`** - View log directory, server URLs, session metadata
- **`get_diagnostics`** - Consolidated view of all logs with summary
- **`get_logs`** - Query specific log channels (console, errors)

## Architecture

- **Server-side**: Custom HTTP server wraps Next.js, provides MCP/RPC endpoints
- **Client-side**: Browser imports client code, patches console, connects via RPC
- **Communication**: Capnweb bidirectional RPC over WebSocket at `/__rpc`
- **Storage**: NDJSON log files in `/tmp/vite-harness-{sessionId}/`

## Future Waves

- **Wave 2**: Error handlers, `eval_in_browser`, `query_dom` (bidirectional RPC)
- **Wave 3**: Network request tracking (fetch/XHR)
- **Wave 4**: CDP support (Playwright), React fiber tree monitoring

## Comparison to vite-live-dev-mcp

| Feature | Vite Version | Next.js Version |
|---------|--------------|-----------------|
| HMR Protocol | `import.meta.hot` | Custom RPC (no HMR dependency) |
| Client Injection | Auto via transform | Manual import in layout |
| Bundler Support | Vite | Turbopack + webpack |
| Server Integration | Plugin hooks | Custom server wrapper |

## License

MIT
