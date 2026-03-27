// Agent client — connect to gateway and get live remote DOM
//
// Usage:
//   import { connect } from 'web-dev-mcp-gateway/agent'
//   const browser = await connect('ws://localhost:3333/__rpc/agent')
//   const title = await browser.document.title
//   await browser.document.querySelector('a').click()
//   browser.close()

import { RpcSession } from 'capnweb'
import WebSocket from 'ws'

interface GatewayStub {
  document: any
  window: any
  localStorage: any
  sessionStorage: any
  navigate(url: string): Promise<{ navigated: string }>
  getBrowserCount(): Promise<number>
  getBrowserList(): Promise<Array<{ connId: string; browserId: string | null }>>
}

export interface BrowserConnection {
  /** Remote document — chain DOM calls directly */
  document: any
  /** Remote window object */
  window: any
  /** Navigate to a URL (triggers page reload, reconnect after) */
  navigate(url: string): Promise<{ navigated: string }>
  /** How many browsers are connected */
  getBrowserCount(): Promise<number>
  /** Close the connection */
  close(): void
}

export function connect(url: string): Promise<BrowserConnection> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)

    ws.on('error', reject)
    ws.on('open', () => {
      const queue: string[] = []
      let resolver: ((msg: string) => void) | null = null
      let rejecter: ((err: Error) => void) | null = null

      ws.on('message', (data) => {
        const msg = data.toString()
        if (resolver) {
          const r = resolver
          resolver = null
          rejecter = null
          r(msg)
        } else {
          queue.push(msg)
        }
      })
      ws.on('close', () => {
        if (rejecter) {
          rejecter(new Error('WebSocket closed'))
          resolver = null
          rejecter = null
        }
      })

      const transport = {
        send(m: string) {
          return new Promise<void>((r, j) => ws.send(m, (e) => (e ? j(e) : r())))
        },
        receive() {
          if (queue.length) return Promise.resolve(queue.shift()!)
          return new Promise<string>((r, j) => { resolver = r; rejecter = j })
        },
        abort(reason: any) {
          ws.close(1011, String(reason).slice(0, 123))
        },
      }

      const session = new RpcSession<GatewayStub>(transport)
      const gw = session.getRemoteMain()

      resolve({
        document: gw.document,
        window: gw.window,
        navigate: (url: string) => gw.navigate(url),
        getBrowserCount: () => gw.getBrowserCount(),
        close: () => ws.close(),
      })
    })
  })
}
