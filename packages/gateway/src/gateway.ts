import http from 'node:http'
import https from 'node:https'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import httpProxy from 'http-proxy'
import { WebSocketServer } from 'ws'
import type { GatewayOptions } from './types.js'
import { initSession, type SessionState } from './session.js'
import { ConsoleWriter } from './writers/console.js'
import { ErrorsWriter } from './writers/errors.js'
import { NetworkWriter } from './writers/network.js'
import { DevEventsWriter, type BuildEventPayload } from './writers/dev-events.js'
import { createMcpMiddleware, sendNotificationToAll, type McpContext } from './mcp-server.js'
import { setupRpcWebSocket } from './rpc-server.js'
import { createCdpMiddleware, setupCdpWebSocket, type CdpContext } from './cdp-server.js'
import { autoRegister } from './auto-register.js'
import { ServerRegistry, type RegisteredServer } from './registry.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Writers {
  console: ConsoleWriter
  errors: ErrorsWriter
  network?: NetworkWriter
  devEvents: DevEventsWriter
}

function generateSelfSignedCert(): { cert: string; key: string } {
  const certDir = join(homedir(), '.web-dev-mcp', 'certs')
  const certPath = join(certDir, 'cert.pem')
  const keyPath = join(certDir, 'key.pem')

  if (existsSync(certPath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certPath, 'utf-8'),
      key: readFileSync(keyPath, 'utf-8'),
    }
  }

  mkdirSync(certDir, { recursive: true })

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
    { stdio: 'pipe' }
  )

  return {
    cert: readFileSync(certPath, 'utf-8'),
    key: readFileSync(keyPath, 'utf-8'),
  }
}

function addCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export async function startGateway(options: GatewayOptions) {
  const port = options.port ?? 3333
  const target = options.target
  const mcpPath = '/__mcp'
  const useHttps = options.https ?? false

  // Load bundled client script
  let clientScript: string
  try {
    clientScript = readFileSync(join(__dirname, 'client.js'), 'utf-8')
  } catch {
    console.error('[web-dev-mcp] Could not load client.js bundle. Run `npm run build` first.')
    process.exit(1)
  }

  // Create server registry for hybrid architecture
  const registry = new ServerRegistry()

  // Start heartbeat to clean up dead servers
  const heartbeatInterval = setInterval(() => {
    const removed = registry.cleanupDeadServers()
    if (removed > 0) {
      console.log(`[registry] Cleaned up ${removed} dead server(s)`)
    }
  }, 5000)

  // Create HTTP proxy only when target is provided (proxy mode)
  let proxy: ReturnType<typeof httpProxy.createProxyServer> | null = null

  if (target) {
    const p = httpProxy.createProxyServer({
      target,
      changeOrigin: true,
      selfHandleResponse: true,
    })
    proxy = p

    p.on('error', (err, _req, res) => {
      console.error(`[web-dev-mcp] Proxy error: ${err.message}`)
      if (res && 'writeHead' in res && !res.headersSent) {
        (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'text/plain' })
        ;(res as http.ServerResponse).end(`Gateway error: ${err.message}\nIs your dev server running at ${target}?`)
      }
    })

    // Handle ALL proxy responses — inject script into HTML, pass through everything else
    p.on('proxyRes', (proxyRes, _req, res) => {
      const contentType = proxyRes.headers['content-type'] ?? ''
      const isHtml = contentType.includes('text/html')

      if (!isHtml) {
        (res as http.ServerResponse).writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res as http.ServerResponse)
        return
      }

      // Buffer HTML to inject client script
      const chunks: Buffer[] = []
      const contentEncoding = proxyRes.headers['content-encoding']

      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        let buffer = Buffer.concat(chunks)

        // Decompress if gzipped
        if (contentEncoding === 'gzip') {
          try {
            buffer = gunzipSync(buffer)
          } catch (err) {
            console.error('[web-dev-mcp] Failed to decompress gzip:', err)
            // Send as-is if decompression fails
            ;(res as http.ServerResponse).writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
            ;(res as http.ServerResponse).end(buffer)
            return
          }
        }

        let html = buffer.toString('utf-8')

        // Build injection: optional flags + client script
        let injection = ''
        if (options.react) {
          injection += `<script>window.__WEB_DEV_MCP_REACT__=true</script>`
        }

        // In hybrid mode, tell client which server it belongs to
        if (registry.size() > 0) {
          const latestServer = registry.getLatest()
          if (latestServer) {
            injection += `<script>window.__WEB_DEV_MCP_SERVER__='${latestServer.id}'</script>`
          }
        }

        injection += `<script src="/__client.js"></script>`

        if (html.includes('</head>')) {
          html = html.replace('</head>', injection + '</head>')
        } else if (html.includes('</body>')) {
          html = html.replace('</body>', injection + '</body>')
        } else {
          html += injection
        }

        const headers = { ...proxyRes.headers }
        delete headers['content-length']
        delete headers['content-encoding']

        ;(res as http.ServerResponse).writeHead(proxyRes.statusCode ?? 200, headers)
        ;(res as http.ServerResponse).end(html)
      })
    })
  }

  // Initialize session
  const protocol = useHttps ? 'https' : 'http'
  const serverUrl = `${protocol}://localhost:${port}`
  const session = initSession(options, serverUrl, mcpPath)

  // Initialize writers
  const writers: Writers = {
    console: new ConsoleWriter(session.files.console, options.maxFileSizeMb),
    errors: new ErrorsWriter(session.files.errors, options.maxFileSizeMb),
    devEvents: new DevEventsWriter(session.files['dev-events'], options.maxFileSizeMb),
  }
  if (options.network && session.files.network) {
    writers.network = new NetworkWriter(session.files.network, options.maxFileSizeMb)
  }

  // CDP context
  const cdpCtx: CdpContext = { serverUrl }

  // MCP context
  const mcpCtx: McpContext = {
    session,
    connectedClients: 0,
    devEventsWriter: writers.devEvents,
    registry,
  }

  const mcpMiddleware = createMcpMiddleware(mcpPath, mcpCtx)
  const cdpMiddleware = createCdpMiddleware(cdpCtx)

  // Request handler
  function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url ?? ''

    // CORS preflight
    if (req.method === 'OPTIONS') {
      addCorsHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    // Serve client script
    if (url === '/__client.js') {
      addCorsHeaders(res)
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
      })
      res.end(clientScript)
      return
    }

    // Gateway registration endpoints
    if (url === '/__gateway/register' && req.method === 'POST') {
      addCorsHeaders(res)
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body) as Partial<RegisteredServer>

          if (!data.type || !data.port || !data.pid) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing required fields: type, port, pid' }))
            return
          }

          const server: RegisteredServer = {
            id: `${data.type}-${data.port}`,
            type: data.type as RegisteredServer['type'],
            port: data.port,
            pid: data.pid,
            name: data.name,
            rpcEndpoint: data.rpcEndpoint,
            mcpEndpoint: data.mcpEndpoint,
            logPaths: data.logPaths,
            registeredAt: Date.now(),
          }

          registry.add(server)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            gatewayMcpUrl: `${serverUrl}${mcpPath}/sse`,
            gatewayRpcUrl: `${serverUrl.replace('http', 'ws')}/__rpc`,
            serverId: server.id,
          }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Invalid request: ${err}` }))
        }
      })
      return
    }

    if (url === '/__gateway/servers' && req.method === 'GET') {
      addCorsHeaders(res)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        servers: registry.getAll(),
        count: registry.size(),
      }, null, 2))
      return
    }

    if (url.startsWith('/__gateway/unregister/') && req.method === 'POST') {
      addCorsHeaders(res)
      const serverId = url.split('/').pop()
      if (serverId && registry.has(serverId)) {
        registry.remove(serverId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Server not found' }))
      }
      return
    }

    // MCP endpoints
    if (url.startsWith(mcpPath)) {
      addCorsHeaders(res)
      mcpMiddleware(req, res, () => {
        res.writeHead(404)
        res.end('Not found')
      })
      return
    }

    // CDP endpoints
    if (url.startsWith('/__cdp')) {
      cdpMiddleware(req, res, () => {
        res.writeHead(404)
        res.end('Not found')
      })
      return
    }

    // Gateway status page
    if (url === '/__status') {
      addCorsHeaders(res)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        gateway: 'web-dev-mcp',
        mode: target ? (registry.size() > 0 ? 'hybrid' : 'proxy') : 'hub',
        target: target ?? null,
        session: session.info,
        registered_servers: registry.getAll(),
        uptime_ms: Date.now() - session.startedAt,
      }, null, 2))
      return
    }

    // Proxy: fixed target, or dynamic target from URL path
    if (proxy) {
      proxy.web(req, res)
      return
    }

    // Dynamic proxy: URL path contains the target, e.g. /http://localhost:3000/page
    const targetMatch = url.match(/^\/(https?:\/\/.+)/)
    if (targetMatch) {
      const targetUrl = new URL(targetMatch[1])
      req.url = targetUrl.pathname + targetUrl.search
      const dynamicProxy = httpProxy.createProxyServer({
        target: targetUrl.origin,
        changeOrigin: true,
        selfHandleResponse: true,
      })
      dynamicProxy.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end(`Proxy error: ${err.message}\nTarget: ${targetUrl.origin}`)
        }
      })
      dynamicProxy.on('proxyRes', (proxyRes) => {
        const contentType = proxyRes.headers['content-type'] ?? ''
        if (!contentType.includes('text/html')) {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
          proxyRes.pipe(res)
          return
        }
        // Inject client script into HTML
        const chunks: Buffer[] = []
        const contentEncoding = proxyRes.headers['content-encoding']
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
        proxyRes.on('end', () => {
          let buffer = Buffer.concat(chunks)
          if (contentEncoding === 'gzip') {
            try { buffer = gunzipSync(buffer) } catch { res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers); res.end(buffer); return }
          }
          let html = buffer.toString('utf-8')
          const injection = `<script src="/__client.js"></script>`
          if (html.includes('</head>')) html = html.replace('</head>', injection + '</head>')
          else if (html.includes('</body>')) html = html.replace('</body>', injection + '</body>')
          else html += injection
          const headers = { ...proxyRes.headers }
          delete headers['content-length']
          delete headers['content-encoding']
          res.writeHead(proxyRes.statusCode ?? 200, headers)
          res.end(html)
        })
      })
      dynamicProxy.web(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }

  // Create server (HTTP or HTTPS)
  let server: http.Server | https.Server
  if (useHttps) {
    let cert: string, key: string
    if (options.cert && options.key) {
      cert = readFileSync(options.cert, 'utf-8')
      key = readFileSync(options.key, 'utf-8')
    } else {
      const generated = generateSelfSignedCert()
      cert = generated.cert
      key = generated.key
    }
    server = https.createServer({ cert, key }, handleRequest)
  } else {
    server = http.createServer(handleRequest)
  }

  // Setup events WebSocket (browser → server for console/errors/network)
  const eventsWss = new WebSocketServer({ noServer: true })

  // Setup dev-events WebSocket (adapters → server for HMR/build events)
  const devEventsWss = new WebSocketServer({ noServer: true })

  // Setup RPC WebSocket (capnweb for eval/queryDom)
  setupRpcWebSocket(server, '/__rpc')

  // Setup CDP WebSocket
  setupCdpWebSocket(server, cdpCtx)

  // Upgrade handler for events + dev-events + proxy WS
  server.on('upgrade', (request: http.IncomingMessage, socket: any, head: Buffer) => {
    const url = request.url ?? ''

    if (url === '/__events' || url.startsWith('/__events?')) {
      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        eventsWss.emit('connection', ws, request)
      })
    } else if (url === '/__dev-events' || url.startsWith('/__dev-events?')) {
      devEventsWss.handleUpgrade(request, socket, head, (ws) => {
        devEventsWss.emit('connection', ws, request)
      })
    } else if (url === '/__rpc' || url.startsWith('/__rpc?')) {
      // Handled by setupRpcWebSocket's own upgrade listener
    } else if (url.startsWith('/__cdp/devtools/')) {
      // Handled by setupCdpWebSocket's own upgrade listener
    } else if (proxy) {
      // Proxy WebSocket to target
      proxy.ws(request, socket, head)
    } else {
      socket.destroy()
    }
  })

  eventsWss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        const { channel, payload } = msg

        if (channel === 'console') {
          writers.console.write(payload)
        } else if (channel === 'error') {
          writers.errors.write(payload)
          // Push notification to MCP clients
          sendNotificationToAll('errors', payload.message ?? 'Error', session.files.errors ?? '', `get_diagnostics`)
        } else if (channel === 'network' && writers.network) {
          writers.network.write(payload)
        }
      } catch {
        // Ignore malformed messages
      }
    })
  })

  devEventsWss.on('connection', (ws) => {
    console.log('[web-dev-mcp] Dev adapter connected')

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString()) as BuildEventPayload
        writers.devEvents.write(payload)

        if (payload.type === 'build:error') {
          sendNotificationToAll('build', payload.error ?? 'Build error', session.files['dev-events'] ?? '', `get_build_status`)
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      console.log('[web-dev-mcp] Dev adapter disconnected')
    })
  })

  // Auto-register
  if (options.autoRegister) {
    const registered = autoRegister(process.cwd(), session.info.mcpUrl)
    for (const path of registered) {
      console.log(`  Auto-registered: ${path}`)
    }
  }

  server.listen(port, () => {
    const proto = useHttps ? 'https' : 'http'
    console.log('')
    console.log(`  web-dev-mcp gateway`)
    console.log(`  ───────────────────────────────`)
    console.log(`  Listen:  ${proto}://localhost:${port}`)
    if (target) {
      console.log(`  Mode:    proxy → ${target}`)
    } else {
      console.log(`  Mode:    hub (no proxy target)`)
    }
    console.log(`  MCP:     ${proto}://localhost:${port}${mcpPath}/sse`)
    console.log(`  CDP:     ${proto}://localhost:${port}/__cdp`)
    console.log(`  Logs:    ${session.logDir}`)
    if (useHttps) console.log(`  HTTPS:   enabled`)
    console.log('')
  })

  return server
}
