import http from 'node:http'
import https from 'node:https'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { WebSocketServer } from 'ws'
import type { GatewayOptions } from './types.js'
import { initSession, type SessionState } from './session.js'
import { ConsoleWriter } from './writers/console.js'
import { ErrorsWriter } from './writers/errors.js'
import { NetworkWriter } from './writers/network.js'
import { DevEventsWriter, type BuildEventPayload } from './writers/dev-events.js'
import { createMcpMiddleware, sendNotificationToAll, type McpContext } from './mcp-server.js'
import { nodeHttpBatchRpcResponse } from 'capnweb'
import { setupRpcWebSocket, setupAgentRpcWebSocket, GatewayApi, onBrowserEvent, emitLogEvent } from './rpc-server.js'
import { handleAdmin } from './admin.js'
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

  // Optional proxy plugin — if web-dev-mcp-proxy is installed, mount it
  let proxyMiddleware: ((req: any, res: any, next: () => void) => void) | null = null
  try {
    const { createProxyMiddleware } = await import('web-dev-mcp-proxy')
    proxyMiddleware = createProxyMiddleware(clientScript)
    console.log('  [web-dev-mcp] Proxy plugin loaded')
  } catch {
    // Not installed — no proxy, that's fine
  }

  // Admin SSE clients for real-time event streaming
  const adminClients = new Set<{ res: http.ServerResponse; browserId?: string }>()

  function broadcastToAdmin(event: string, data: any) {
    const json = JSON.stringify(data)
    for (const client of adminClients) {
      if (client.browserId && data.browserId && client.browserId !== data.browserId) continue
      client.res.write(`event: ${event}\ndata: ${json}\n\n`)
    }
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

  // MCP context
  const mcpCtx: McpContext = {
    session,
    connectedClients: 0,
    devEventsWriter: writers.devEvents,
    registry,
  }

  const mcpMiddleware = createMcpMiddleware(mcpPath, mcpCtx)

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

    // Gateway status page
    if (url === '/__status') {
      addCorsHeaders(res)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        gateway: 'web-dev-mcp',
        mode: registry.size() > 0 ? 'hybrid' : 'hub',
        session: session.info,
        registered_servers: registry.getAll(),
        uptime_ms: Date.now() - session.startedAt,
      }, null, 2))
      return
    }

    // capnweb HTTP batch endpoint — stateless per request
    if (url === '/__rpc/batch') {
      nodeHttpBatchRpcResponse(req, res, new GatewayApi(), {
        headers: { 'Access-Control-Allow-Origin': '*' },
      }).catch((err: any) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(`Batch RPC error: ${err.message}`)
        }
      })
      return
    }

    // Admin UI
    if (handleAdmin(req, res, url, { startedAt: session.startedAt, registry, port })) return

    // Admin SSE event stream
    if (url.startsWith('/__admin/events')) {
      const params = new URL(url, 'http://localhost').searchParams
      const browserId = params.get('browser_id') || undefined
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write('event: connected\ndata: {}\n\n')
      const client = { res, browserId }
      adminClients.add(client)
      const keepalive = setInterval(() => res.write(':keepalive\n\n'), 30000)
      req.on('close', () => { adminClients.delete(client); clearInterval(keepalive) })
      return
    }

    // Try optional proxy plugin (npm install web-dev-mcp-proxy)
    if (proxyMiddleware) {
      proxyMiddleware(req, res, () => {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not found')
      })
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
  setupAgentRpcWebSocket(server, '/__rpc/agent')

  // Broadcast browser connect/disconnect to admin SSE
  onBrowserEvent((event, data) => {
    broadcastToAdmin(event === 'connect' ? 'browser_connect' : 'browser_disconnect', data)
  })

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
    } else if (url === '/__rpc' || url.startsWith('/__rpc?') || url.startsWith('/__rpc/agent')) {
      // Handled by setupRpcWebSocket / setupAgentRpcWebSocket upgrade listeners
    } else {
      socket.destroy()
    }
  })

  eventsWss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        const { channel, payload, browserId } = msg
        // Tag payload with browser ID for filtering
        if (browserId) payload.browserId = browserId

        if (channel === 'console') {
          writers.console.write(payload)
        } else if (channel === 'error') {
          writers.errors.write(payload)
          sendNotificationToAll('errors', payload.message ?? 'Error', session.files.errors ?? '', `get_diagnostics`)
        } else if (channel === 'network' && writers.network) {
          writers.network.write(payload)
        }

        // Push to admin SSE clients + capnweb stream subscribers
        broadcastToAdmin('log', { channel, payload, browserId })
        emitLogEvent({ channel, payload, browserId })
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
    console.log(`  MCP:     ${proto}://localhost:${port}${mcpPath}/sse`)
    console.log(`  Logs:    ${session.logDir}`)
    if (useHttps) console.log(`  HTTPS:   enabled`)
    console.log('')
  })

  return server
}
