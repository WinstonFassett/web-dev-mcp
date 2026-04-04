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
import { ServerConsoleWriter } from './writers/server-console.js'
import { createMcpMiddleware, sendNotificationToAll, type McpContext } from './mcp-server.js'
import { setupRpcWebSocket, onBrowserEvent, emitLogEvent, removeBrowsersByServer } from './rpc-server.js'
import { handleAdmin } from './admin.js'
import { ServerRegistry, type RegisteredServer, makeServerId, makeProjectId, initProjectLogDir } from './registry.js'
import { handleElementGrabRequest } from './element-grab.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Writers {
  console: ConsoleWriter
  errors: ErrorsWriter
  network?: NetworkWriter
  devEvents: DevEventsWriter
  serverConsole: ServerConsoleWriter
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
    clientScript = readFileSync(join(__dirname, 'web-dev-mcp-client.js'), 'utf-8')
  } catch {
    console.error('[web-dev-mcp] Could not load web-dev-mcp-client.js bundle. Run `npm run build` first.')
    process.exit(1)
  }

  // Optional proxy plugin — if web-dev-mcp-proxy is installed, mount it
  let proxyMiddleware: ((req: any, res: any, next: () => void) => void) | null = null
  try {
    const { createProxyMiddleware } = await import('web-dev-mcp-proxy' as string)
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

  // Start heartbeat to clean up dead servers and their orphaned browsers
  const heartbeatInterval = setInterval(() => {
    const removedIds = registry.cleanupDeadServers()
    for (const id of removedIds) {
      removeBrowsersByServer(id)
    }
    if (removedIds.length > 0) {
      console.log(`[registry] Cleaned up ${removedIds.length} dead server(s)`)
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
    serverConsole: new ServerConsoleWriter(session.files['server-console'], options.maxFileSizeMb),
  }
  if (options.network && session.files.network) {
    writers.network = new NetworkWriter(session.files.network, options.maxFileSizeMb)
  }

  // Per-project writers (populated when servers register)
  const projectWriters = new Map<string, Writers>()

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
    if (url === '/__web-dev-mcp.js' || url === '/__client.js') {
      addCorsHeaders(res)
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache',
      })
      res.end(clientScript)
      return
    }

    // Serve lazy-loaded libs (screenshot library, etc.)
    if (url.startsWith('/__libs/')) {
      const libName = url.slice('/__libs/'.length)
      try {
        const libPath = join(__dirname, 'libs', libName)
        const content = readFileSync(libPath, 'utf-8')
        addCorsHeaders(res)
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=31536000, immutable',
        })
        res.end(content)
      } catch {
        res.writeHead(404)
        res.end('Not found')
      }
      return
    }

    // Element-grab: serve script + HTTP selection endpoints
    if (url === '/__element-grab.js') {
      addCorsHeaders(res)
      try {
        const script = readFileSync(join(__dirname, 'element-grab-client.js'), 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
        res.end(script)
      } catch {
        res.writeHead(404)
        res.end('element-grab not built')
      }
      return
    }
    if (url.startsWith('/__element-grab/')) {
      addCorsHeaders(res)
      if (handleElementGrabRequest(req, res, url)) return
    }

    // Gateway registration endpoints
    if (url === '/__gateway/register' && req.method === 'POST') {
      addCorsHeaders(res)
      let body = ''
      req.on('data', chunk => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)

          if (!data.type || !data.port || !data.pid || !data.directory) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing required fields: type, port, pid, directory' }))
            return
          }

          // Create per-project log directory
          const channels = ['console', 'errors', 'dev-events', 'server-console']
          if (options.network) channels.push('network')
          const { logDir, logPaths } = initProjectLogDir(data.directory, channels)

          const server: RegisteredServer = {
            id: data.id || makeServerId(data.pid),
            projectId: makeProjectId(data.directory),
            directory: data.directory,
            type: data.type as RegisteredServer['type'],
            port: data.port,
            pid: data.pid,
            name: data.name,
            rpcEndpoint: data.rpcEndpoint,
            mcpEndpoint: data.mcpEndpoint,
            logPaths,
            logDir,
            registeredAt: Date.now(),
          }

          registry.add(server)

          // Create per-project writers (keyed by directory — logs are project-scoped)
          projectWriters.set(server.directory, {
            console: new ConsoleWriter(logPaths.console, options.maxFileSizeMb),
            errors: new ErrorsWriter(logPaths.errors, options.maxFileSizeMb),
            devEvents: new DevEventsWriter(logPaths['dev-events'], options.maxFileSizeMb),
            serverConsole: new ServerConsoleWriter(logPaths['server-console'], options.maxFileSizeMb),
            network: logPaths.network ? new NetworkWriter(logPaths.network, options.maxFileSizeMb) : undefined,
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            serverId: server.id,
            projectId: server.projectId,
            logDir,
            gatewayMcpUrl: `${serverUrl}${mcpPath}/sse`,
            gatewayRpcUrl: `${serverUrl.replace('http', 'ws')}/__rpc`,
          }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Invalid request: ${err}` }))
        }
      })
      return
    }

    // Browser init endpoint — returns serverId + gatewayUrl for runtime client config
    if (url.startsWith('/__gateway/init') && req.method === 'GET') {
      addCorsHeaders(res)
      const urlObj = new URL(url, 'http://localhost')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify({
        serverId: urlObj.searchParams.get('server') || null,
        gatewayUrl: urlObj.searchParams.get('gateway') || serverUrl,
      }))
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
        const server = registry.get(serverId)
        registry.remove(serverId)
        removeBrowsersByServer(serverId)
        if (server) projectWriters.delete(server.directory)
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

    // Landing page
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>web-dev-mcp</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .wrap{text-align:center;max-width:520px;width:100%;padding:2rem}
  h1{font-size:1.4rem;font-weight:500;margin-bottom:.5rem;color:#fff}
  .section{margin-top:2rem}
  .section h2{font-size:.95rem;font-weight:500;color:#888;margin-bottom:.75rem}
  form{display:flex;gap:.5rem}
  input{flex:1;padding:.6rem .8rem;border-radius:6px;border:1px solid #333;background:#141414;color:#e0e0e0;font-size:.9rem;outline:none}
  input:focus{border-color:#555}
  input::placeholder{color:#444}
  button{padding:.6rem 1.2rem;border-radius:6px;border:none;background:#fff;color:#000;font-size:.9rem;font-weight:500;cursor:pointer}
  button:hover{background:#ddd}
  a.link{display:inline-block;padding:.6rem 1.2rem;border-radius:6px;border:1px solid #333;color:#e0e0e0;text-decoration:none;font-size:.9rem}
  a.link:hover{border-color:#555;background:#141414}
</style>
</head><body>
<div class="wrap">
  <h1>web-dev-mcp</h1>
  <div class="section">
    <a class="link" href="/__admin">Admin Dashboard &rarr;</a>
  </div>${proxyMiddleware ? `
  <div class="section">
    <h2>Proxy</h2>
    <form onsubmit="event.preventDefault();var u=this.url.value.trim();if(u){if(!/^https?:\\/\\//.test(u))u='http://'+u;location.href='/'+u}">
      <input name="url" type="text" placeholder="http://localhost:3000" autofocus>
      <button type="submit">Go</button>
    </form>
  </div>` : ''}
</div>
</body></html>`)
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

  // Setup command WebSocket (browser ↔ gateway JSON protocol)
  setupRpcWebSocket(server, '/__rpc')

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
    } else if (url === '/__rpc' || url.startsWith('/__rpc?')) {
      // Handled by setupRpcWebSocket upgrade listener
    } else {
      socket.destroy()
    }
  })

  eventsWss.on('connection', (ws, request) => {
    // Parse serverId from query param, resolve to project directory for writer routing
    const reqUrl = (request as any).url ?? ''
    const serverMatch = reqUrl.match(/[?&]server=([^&]+)/)
    const serverId = serverMatch ? decodeURIComponent(serverMatch[1]) : null
    const projectDir = serverId ? registry.get(serverId)?.directory : null

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        const { channel, payload, browserId } = msg
        // Tag payload with browser ID for filtering
        if (browserId) payload.browserId = browserId

        // Use project-specific writers if available, fall back to gateway writers
        const w = (projectDir && projectWriters.get(projectDir)) || writers

        if (channel === 'console') {
          w.console.write(payload)
        } else if (channel === 'error') {
          w.errors.write(payload)
          const server = serverId ? registry.get(serverId) : null
          const logFile = server?.logPaths?.errors ?? session.files.errors ?? ''
          sendNotificationToAll('errors', payload.message ?? 'Error', logFile, `get_diagnostics`)
        } else if (channel === 'server-console') {
          w.serverConsole.write(payload)
          if (payload.level === 'error') {
            const server = serverId ? registry.get(serverId) : null
            const logFile = server?.logPaths?.['server-console'] ?? session.files['server-console'] ?? ''
            sendNotificationToAll('server', payload.args?.join(' ') ?? 'Server error', logFile, `get_diagnostics`)
          }
        } else if (channel === 'network' && w.network) {
          w.network.write(payload)
        }

        // Push to admin SSE clients + stream subscribers
        broadcastToAdmin('log', { channel, payload, browserId })
        emitLogEvent({ channel, payload, browserId })
      } catch {
        // Ignore malformed messages
      }
    })
  })

  devEventsWss.on('connection', (ws, request) => {
    // Parse serverId from query param, resolve to project directory
    const reqUrl = (request as any).url ?? ''
    const serverMatch = reqUrl.match(/[?&]server=([^&]+)/)
    const serverId = serverMatch ? decodeURIComponent(serverMatch[1]) : null
    const projectDir = serverId ? registry.get(serverId)?.directory : null

    console.log(`[web-dev-mcp] Dev adapter connected${serverId ? ` (server: ${serverId})` : ''}`)

    ws.on('message', (data) => {
      try {
        const payload = JSON.parse(data.toString()) as BuildEventPayload
        const w = (projectDir && projectWriters.get(projectDir)) || writers
        w.devEvents.write(payload)

        if (payload.type === 'build:error') {
          const server = serverId ? registry.get(serverId) : null
          const logFile = server?.logPaths?.['dev-events'] ?? session.files['dev-events'] ?? ''
          sendNotificationToAll('build', payload.error ?? 'Build error', logFile, `get_build_status`)
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      console.log(`[web-dev-mcp] Dev adapter disconnected${serverId ? ` (server: ${serverId})` : ''}`)
    })
  })


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
