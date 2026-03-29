/**
 * capnweb connection to gateway's /__rpc/agent endpoint.
 * Singleton — shared across all components.
 */

import { RpcSession } from 'capnweb'

interface GatewayStub {
  getBrowserCount(): Promise<number>
  getBrowserList(): Promise<Array<{ connId: string; browserId: string | null; serverId: string | null; connectedAt: number }>>
  listProjects(): Promise<string[]>
  getProject(serverId?: string): any
  subscribeEvents(browserId?: string): Promise<ReadableStream>
}

export interface GatewayConnection {
  stub: GatewayStub
  close(): void
  readonly connected: boolean
}

function createTransport(ws: WebSocket) {
  const queue: string[] = []
  let resolver: ((msg: string) => void) | null = null
  let rejecter: ((err: Error) => void) | null = null

  function deliver(msg: string) {
    if (resolver) {
      const r = resolver
      resolver = null
      rejecter = null
      r(msg)
    } else {
      queue.push(msg)
    }
  }

  ws.addEventListener('message', (e) => {
    if (typeof e.data === 'string') {
      deliver(e.data)
    } else if (e.data instanceof Blob) {
      e.data.text().then(deliver)
    } else {
      deliver(String(e.data))
    }
  })

  ws.addEventListener('close', () => {
    if (rejecter) {
      rejecter(new Error('WebSocket closed'))
      resolver = null
      rejecter = null
    }
  })

  return {
    send(m: string) {
      return new Promise<void>((resolve, reject) => {
        try { ws.send(m); resolve() } catch (e) { reject(e) }
      })
    },
    receive() {
      if (queue.length) return Promise.resolve(queue.shift()!)
      return new Promise<string>((r, j) => { resolver = r; rejecter = j })
    },
    abort(reason: any) {
      ws.close(1011, String(reason).slice(0, 123))
    },
  }
}

const GATEWAY_WS = 'ws://localhost:3333/__rpc/agent'

// Singleton connection — shared across all components
let _instance: Promise<GatewayConnection> | null = null

export function getGateway(): Promise<GatewayConnection> {
  if (_instance) return _instance
  _instance = new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_WS)
    let connected = true

    ws.addEventListener('open', () => {
      const transport = createTransport(ws)
      const session = new RpcSession<GatewayStub>(transport)
      const stub = session.getRemoteMain()

      resolve({
        stub,
        close() { connected = false; ws.close(); _instance = null },
        get connected() { return connected && ws.readyState === WebSocket.OPEN },
      })
    })

    ws.addEventListener('error', () => {
      if (!connected) return
      _instance = null
      reject(new Error('Could not connect to gateway'))
    })

    ws.addEventListener('close', () => {
      connected = false
      _instance = null
    })
  })
  return _instance
}
