import http from 'http'
import { RpcSession, type RpcTransport } from 'capnweb'
import { WebSocketServer, type WebSocket } from 'ws'
import { initSession } from './core/session.js'
import { ConsoleWriter } from './core/writers/console.js'
import { ErrorsWriter } from './core/writers/errors.js'
import { ServerApi } from './server-api.js'
import { createMcpMiddleware } from './core/mcp-server.js'

// Adapt ws WebSocket to capnweb's RpcTransport
function createWsTransport(ws: WebSocket): RpcTransport {
  const messageQueue: string[] = []
  let resolveWaiter: ((msg: string) => void) | null = null
  let rejectWaiter: ((err: Error) => void) | null = null

  ws.on('message', (data) => {
    const msg = data.toString()
    if (resolveWaiter) {
      const resolve = resolveWaiter
      resolveWaiter = null
      rejectWaiter = null
      resolve(msg)
    } else {
      messageQueue.push(msg)
    }
  })

  ws.on('close', () => {
    if (rejectWaiter) {
      rejectWaiter(new Error('WebSocket closed'))
      resolveWaiter = null
      rejectWaiter = null
    }
  })

  ws.on('error', (err) => {
    if (rejectWaiter) {
      rejectWaiter(err instanceof Error ? err : new Error(String(err)))
      resolveWaiter = null
      rejectWaiter = null
    }
  })

  return {
    send(message: string) {
      return new Promise<void>((resolve, reject) => {
        ws.send(message, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
    receive() {
      if (messageQueue.length > 0) {
        return Promise.resolve(messageQueue.shift()!)
      }
      return new Promise<string>((resolve, reject) => {
        resolveWaiter = resolve
        rejectWaiter = reject
      })
    },
    abort(reason: any) {
      ws.close(1011, String(reason).slice(0, 123))
    },
  }
}

export interface NextMcpServerOptions {
  network?: boolean
  maxFileSizeMb?: number
  printUrl?: boolean
}

/**
 * Create custom Next.js server with MCP observability
 * @param nextApp - Next.js app instance (from `next()`)
 * @param options - Configuration options
 */
export function createMcpServer(nextApp: any, options: NextMcpServerOptions = {}) {
  let consoleWriter: ConsoleWriter | null = null
  let errorsWriter: ErrorsWriter | null = null
  let session: any = null
  const mcpPath = '/__mcp/sse'

  // Create MCP context (will be populated after server starts)
  const mcpCtx: any = {
    serverUrl: '',
    session: null,
    hmrWriter: null, // Not used in Wave 1
    hot: null, // Not used in Wave 1
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? ''

    // MCP middleware
    if (url.startsWith('/__mcp')) {
      const mcpMiddleware = createMcpMiddleware(mcpPath, mcpCtx)
      return mcpMiddleware(req as any, res as any, () => {})
    }

    // Delegate to Next.js
    const handle = nextApp.getRequestHandler()
    return handle(req, res)
  })

  // Init session after server starts listening
  server.on('listening', () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 3000
    const serverUrl = `http://localhost:${port}`
    const mcpUrl = `${serverUrl}${mcpPath}`

    // Init session and writers
    session = initSession(
      process.cwd(),
      options,
      'nextjs',
      serverUrl,
      mcpPath,
    )

    consoleWriter = new ConsoleWriter(session.files.console!, options.maxFileSizeMb ?? 10)
    errorsWriter = new ErrorsWriter(session.files.errors!, options.maxFileSizeMb ?? 10)

    // Update MCP context
    mcpCtx.serverUrl = serverUrl
    mcpCtx.session = session

    // Log URLs
    if (options.printUrl !== false) {
      console.log(`  ➜  next-live-dev-mcp: ${mcpUrl}`)
      console.log(`  ➜  RPC endpoint: ${serverUrl}/__rpc`)
      console.log(`  ➜  log dir: ${session.logDir}`)
    }
  })

  // Setup bidirectional RPC WebSocket
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''

    if (url === '/__rpc' || url.startsWith('/__rpc?')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        // Create transport
        const transport = createWsTransport(ws)

        // Create ServerApi with writers
        const serverApi = new ServerApi(consoleWriter, errorsWriter)

        // Create bidirectional RPC session
        // Server exports ServerApi, gets stub to BrowserApi (Wave 2)
        const session = new RpcSession(transport, serverApi)
        const browserStub = session.getRemoteMain()

        // Log connection
        console.log('[next-live-dev-mcp] Browser RPC connected')

        ws.on('close', () => {
          console.log('[next-live-dev-mcp] Browser RPC disconnected')
        })
      })
    }
  })

  return server
}
