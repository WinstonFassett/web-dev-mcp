import { RpcSession, type RpcTransport, type RpcStub } from 'capnweb'
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

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

export interface BrowserStub {
  eval(expression: string): Promise<string>
  querySelector(selector: string): Promise<any>
  queryDom(selector: string, options: {
    max_depth?: number
    attributes?: string[]
    text_length?: number
  }): Promise<{ html: string; element_count: number; truncated: boolean }>
  getTitle(): Promise<string>
  getUrl(): Promise<string>
}

// Active browser connections
const browserStubs = new Map<string, RpcStub<BrowserStub>>()

export function getBrowserStub(): RpcStub<BrowserStub> | undefined {
  // Return the first connected browser (usually there's only one)
  const first = browserStubs.values().next()
  return first.done ? undefined : first.value
}

export function getBrowserStubCount(): number {
  return browserStubs.size
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

  wss.on('connection', (ws) => {
    const id = Math.random().toString(36).slice(2)
    const transport = createWsTransport(ws)

    // Create RPC session — browser is the remote main, we're the local (no local main for now)
    const session = new RpcSession<BrowserStub>(transport)
    const stub = session.getRemoteMain()
    browserStubs.set(id, stub)

    ws.on('close', () => {
      browserStubs.delete(id)
    })
  })

  return wss
}
