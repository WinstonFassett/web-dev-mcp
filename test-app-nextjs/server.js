import { createMcpServer } from 'next-live-dev-mcp'
import next from 'next'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3000

// Create Next.js app
const app = next({ dev, hostname, port })

// Wait for Next.js to be ready
app.prepare().then(() => {
  // Create custom server with MCP observability
  const server = createMcpServer(app, {
    network: false,
    printUrl: true,
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
