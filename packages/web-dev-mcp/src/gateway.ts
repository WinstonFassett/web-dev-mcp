import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import httpProxy from 'http-proxy'
import { WebSocketServer } from 'ws'
import type { GatewayOptions } from './types.js'
import { initSession, type SessionState } from './session.js'
import { ConsoleWriter } from './writers/console.js'
import { ErrorsWriter } from './writers/errors.js'
import { NetworkWriter } from './writers/network.js'
import { createMcpMiddleware, type McpContext } from './mcp-server.js'
import { setupRpcWebSocket } from './rpc-server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Writers {
  console: ConsoleWriter
  errors: ErrorsWriter
  network?: NetworkWriter
}

export async function startGateway(options: GatewayOptions) {
  const port = options.port ?? 3333
  const target = options.target
  const mcpPath = '/__mcp'

  // Load bundled client script
  let clientScript: string
  try {
    clientScript = readFileSync(join(__dirname, 'client.js'), 'utf-8')
  } catch {
    console.error('[web-dev-mcp] Could not load client.js bundle. Run `npm run build` first.')
    process.exit(1)
  }

  // Create HTTP proxy — always selfHandleResponse so we control piping
  const proxy = httpProxy.createProxyServer({
    target,
    changeOrigin: true,
    selfHandleResponse: true,
  })

  proxy.on('error', (err, _req, res) => {
    console.error(`[web-dev-mcp] Proxy error: ${err.message}`)
    if (res && 'writeHead' in res && !res.headersSent) {
      (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'text/plain' })
      ;(res as http.ServerResponse).end(`Gateway error: ${err.message}\nIs your dev server running at ${target}?`)
    }
  })

  // Handle ALL proxy responses — inject script into HTML, pass through everything else
  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const contentType = proxyRes.headers['content-type'] ?? ''
    const isHtml = contentType.includes('text/html')

    if (!isHtml) {
      // Pass through non-HTML as-is
      (res as http.ServerResponse).writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
      proxyRes.pipe(res as http.ServerResponse)
      return
    }

    // Buffer HTML to inject client script
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf-8')

      const scriptTag = `<script src="/__client.js"></script>`

      if (html.includes('</head>')) {
        html = html.replace('</head>', scriptTag + '</head>')
      } else if (html.includes('</body>')) {
        html = html.replace('</body>', scriptTag + '</body>')
      } else {
        html += scriptTag
      }

      const headers = { ...proxyRes.headers }
      delete headers['content-length']
      delete headers['content-encoding']

      ;(res as http.ServerResponse).writeHead(proxyRes.statusCode ?? 200, headers)
      ;(res as http.ServerResponse).end(html)
    })
  })

  // Initialize session
  const serverUrl = `http://localhost:${port}`
  const session = initSession(options, serverUrl, mcpPath)

  // Initialize writers
  const writers: Writers = {
    console: new ConsoleWriter(session.files.console, options.maxFileSizeMb),
    errors: new ErrorsWriter(session.files.errors, options.maxFileSizeMb),
  }
  if (options.network && session.files.network) {
    writers.network = new NetworkWriter(session.files.network, options.maxFileSizeMb)
  }

  // MCP context
  const mcpCtx: McpContext = {
    session,
    connectedClients: 0,
  }

  const mcpMiddleware = createMcpMiddleware(mcpPath, mcpCtx)

  // Create HTTP server
  const server = http.createServer((req, res) => {
    const url = req.url ?? ''

    // Serve client script
    if (url === '/__client.js') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(clientScript)
      return
    }

    // MCP endpoints
    if (url.startsWith(mcpPath)) {
      mcpMiddleware(req, res, () => {
        res.writeHead(404)
        res.end('Not found')
      })
      return
    }

    // Gateway status page
    if (url === '/__status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        gateway: 'web-dev-mcp',
        target,
        session: session.info,
        uptime_ms: Date.now() - session.startedAt,
      }, null, 2))
      return
    }

    // Proxy everything else (selfHandleResponse handles injection in proxyRes)
    proxy.web(req, res)
  })

  // Setup events WebSocket (browser → server for console/errors/network)
  const eventsWss = new WebSocketServer({ noServer: true })

  // Setup RPC WebSocket (capnweb for eval/queryDom) — uses noServer mode
  const rpcWss = setupRpcWebSocket(server, '/__rpc')

  // Single upgrade handler for all WebSocket paths
  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? ''

    if (url === '/__events' || url.startsWith('/__events?')) {
      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        eventsWss.emit('connection', ws, request)
      })
    } else if (url === '/__rpc' || url.startsWith('/__rpc?')) {
      // Handled by setupRpcWebSocket's own upgrade listener
    } else {
      // Proxy WebSocket to target
      proxy.ws(request, socket, head)
    }
  })

  eventsWss.on('connection', (ws) => {
    console.log('[web-dev-mcp] Events WebSocket connected')

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        const { channel, payload } = msg

        if (channel === 'console') {
          writers.console.write(payload)
        } else if (channel === 'error') {
          writers.errors.write(payload)
        } else if (channel === 'network' && writers.network) {
          writers.network.write(payload)
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      console.log('[web-dev-mcp] Events WebSocket disconnected')
    })
  })

  server.listen(port, () => {
    console.log('')
    console.log(`  web-dev-mcp gateway`)
    console.log(`  ───────────────────────────────`)
    console.log(`  Proxy:   http://localhost:${port}`)
    console.log(`  Target:  ${target}`)
    console.log(`  MCP:     http://localhost:${port}${mcpPath}/sse`)
    console.log(`  Logs:    ${session.logDir}`)
    console.log('')
  })

  return server
}
