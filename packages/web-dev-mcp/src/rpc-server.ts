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

export interface BrowserStub {
  id: string
  getPageInfo(): Promise<{ id: string; title: string; url: string; type: string }>
  cdpConnect(callback: RpcTarget): Promise<boolean>
  cdpSend(message: string): Promise<void>
  cdpDisconnect(): Promise<void>
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
  connectedAt: number
}

const browsers = new Map<string, BrowserConnection>()
const connectionOrder: string[] = []

export function getBrowserStub(): RpcStub<BrowserStub> | undefined {
  if (connectionOrder.length === 0) return undefined
  const connId = connectionOrder[connectionOrder.length - 1]
  return browsers.get(connId)?.stub
}

export function getBrowserStubCount(): number {
  return browsers.size
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

  wss.on('connection', async (ws) => {
    const connId = Math.random().toString(36).slice(2)
    const transport = createWsTransport(ws)

    const session = new RpcSession<BrowserStub>(transport)
    const stub = session.getRemoteMain()

    const conn: BrowserConnection = {
      stub,
      browserId: null,
      connectedAt: Date.now(),
    }

    browsers.set(connId, conn)
    connectionOrder.push(connId)

    try {
      conn.browserId = await stub.id
    } catch {
      // Browser may not support id property yet
    }

    console.log(`[web-dev-mcp] Browser connected (${connId})`)

    ws.on('close', () => {
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
      console.log(`[web-dev-mcp] Browser disconnected (${connId})`)
    })
  })

  return wss
}
