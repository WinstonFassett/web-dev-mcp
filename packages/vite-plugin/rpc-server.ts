import { RpcSession, type RpcTransport, type RpcStub } from 'capnweb'
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'

// Adapt ws WebSocket to capnweb's RpcTransport
function createWsTransport(ws: WsWebSocket): RpcTransport {
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

interface BrowserStub {
  // Browser identity
  id: string
  getPageInfo(): Promise<{ id: string; title: string; url: string; type: string }>

  // Browser interaction
  screenshot(selector?: string): Promise<{ data: string; width: number; height: number } | { error: string }>
  click(selector: string): Promise<{ clicked: string; tag: string } | { error: string }>
  fill(selector: string, value: string): Promise<{ filled: string; value: string } | { error: string }>
  selectOption(selector: string, value: string): Promise<{ selected: string; value: string; text: string } | { error: string }>
  hover(selector: string): Promise<{ hovered: string } | { error: string }>
  pressKey(key: string, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }, selector?: string): Promise<{ key: string; target: string } | { error: string }>
  scroll(selector?: string, x?: number, y?: number): Promise<{ scrolledTo: string | { x: number; y: number } } | { error: string }>
  getVisibleText(selector?: string): Promise<{ text: string; length: number } | { error: string }>

  // Legacy methods
  eval(expression: string): Promise<string>
  queryDom(selector: string, options: {
    max_depth?: number
    attributes?: string[]
    text_length?: number
  }): Promise<{ html: string; element_count: number; truncated: boolean }>
}

interface BrowserConnection {
  stub: RpcStub<BrowserStub>
  browserId: string | null  // Sticky ID from browser, null until first RPC
  connectedAt: number
}

// Active browser connections — keyed by internal connection ID
const browsers = new Map<string, BrowserConnection>()

// Order of connection for first/latest
const connectionOrder: string[] = []

export function getBrowserStub(): RpcStub<BrowserStub> | undefined {
  // Return the latest connected browser
  return getBrowserByAlias('latest')
}

function getBrowserByAlias(alias: 'first' | 'latest'): RpcStub<BrowserStub> | undefined {
  if (connectionOrder.length === 0) return undefined
  const connId = alias === 'first' ? connectionOrder[0] : connectionOrder[connectionOrder.length - 1]
  return browsers.get(connId)?.stub
}

export function setupRpcWebSocket(httpServer: { on(event: string, listener: (...args: any[]) => void): void }, rpcPath: string) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    const url = request.url ?? ''
    if (url === rpcPath || url.startsWith(rpcPath + '?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
    // Don't handle other upgrades — let Vite's HMR WebSocket handle them
  })

  wss.on('connection', async (ws) => {
    const connId = Math.random().toString(36).slice(2)
    const transport = createWsTransport(ws)

    // Create RPC session — browser is the remote main
    const session = new RpcSession<BrowserStub>(transport)
    const stub = session.getRemoteMain()

    const conn: BrowserConnection = {
      stub,
      browserId: null,
      connectedAt: Date.now(),
    }

    browsers.set(connId, conn)
    connectionOrder.push(connId)

    // Fetch browser's sticky ID asynchronously
    try {
      conn.browserId = await stub.id
    } catch {
      // Browser may not support id property yet
    }

    ws.on('close', () => {
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
    })
  })

  return wss
}
