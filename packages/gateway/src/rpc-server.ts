import { RpcSession, RpcTarget, type RpcTransport, type RpcStub } from 'capnweb'
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'

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

  eval(expression: string): Promise<string>
  queryDom(selector: string, options: {
    max_depth?: number
    attributes?: string[]
    text_length?: number
  }): Promise<{ html: string; element_count: number; truncated: boolean }>
}

interface BrowserConnection {
  stub: RpcStub<BrowserStub>
  browserId: string | null
  serverId: string | null  // Which registered server this browser belongs to
  connectedAt: number
}

const browsers = new Map<string, BrowserConnection>()
const connectionOrder: string[] = []

export function getBrowserStub(): RpcStub<BrowserStub> | undefined {
  if (connectionOrder.length === 0) return undefined
  const connId = connectionOrder[connectionOrder.length - 1]
  return browsers.get(connId)?.stub
}

export function getAllBrowsers(): Array<{ connId: string; browserId: string | null; serverId: string | null; connectedAt: number }> {
  return Array.from(browsers.entries()).map(([connId, conn]) => ({
    connId,
    browserId: conn.browserId,
    serverId: conn.serverId,
    connectedAt: conn.connectedAt,
  }))
}

export function setupRpcWebSocket(httpServer: { on(event: string, listener: (...args: any[]) => void): void }, rpcPath: string) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request: any, socket: any, head: any) => {
    const url = request.url ?? ''
    if (url === rpcPath || url.startsWith(rpcPath + '?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', async (ws, request: any) => {
    const connId = Math.random().toString(36).slice(2)
    const transport = createWsTransport(ws)

    // Parse server ID from query parameter (for hybrid mode)
    let serverId: string | null = null
    const url = request.url ?? ''
    const match = url.match(/[?&]server=([^&]+)/)
    if (match) {
      serverId = decodeURIComponent(match[1])
    }

    const session = new RpcSession<BrowserStub>(transport)
    const stub = session.getRemoteMain()

    const conn: BrowserConnection = {
      stub,
      browserId: null,
      serverId,
      connectedAt: Date.now(),
    }

    browsers.set(connId, conn)
    connectionOrder.push(connId)

    try {
      conn.browserId = await stub.id
    } catch {
      // Browser may not support id property yet
    }

    const serverInfo = serverId ? ` for server ${serverId}` : ''
    console.log(`[web-dev-mcp] Browser connected (${connId})${serverInfo}`)

    ws.on('close', () => {
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
      console.log(`[web-dev-mcp] Browser disconnected (${connId})`)
    })
  })

  return wss
}

// --- Agent RPC endpoint ---
// Agents connect here and get a GatewayApi that proxies to the browser's document/window

export class GatewayApi extends RpcTarget {
  get document() {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).document
  }
  get window() {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).window
  }
  get localStorage() {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).localStorage
  }
  get sessionStorage() {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).sessionStorage
  }
  navigate(url: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).navigate(url)
  }
  getPageMarkdown(selector?: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).getPageMarkdown(selector)
  }
  getVisibleText(selector?: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).getVisibleText(selector)
  }
  screenshot(selector?: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).screenshot(selector)
  }
  click(selector: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).click(selector)
  }
  fill(selector: string, value: string) {
    const stub = getBrowserStub()
    if (!stub) throw new Error('No browser connected')
    return (stub as any).fill(selector, value)
  }
  getBrowserCount() {
    return browsers.size
  }
  getBrowserList() {
    return getAllBrowsers()
  }
}

export function setupAgentRpcWebSocket(httpServer: { on(event: string, listener: (...args: any[]) => void): void }, agentPath: string) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request: any, socket: any, head: any) => {
    const url = request.url ?? ''
    if (url === agentPath || url.startsWith(agentPath + '?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', (ws) => {
    const connId = Math.random().toString(36).slice(2)
    const transport = createWsTransport(ws)
    const api = new GatewayApi()
    const session = new RpcSession(transport, api)

    console.log(`[web-dev-mcp] Agent connected (${connId})`)

    ws.on('close', () => {
      console.log(`[web-dev-mcp] Agent disconnected (${connId})`)
    })
  })

  return wss
}
