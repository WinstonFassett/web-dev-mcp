// Agent client — connect to gateway and get live remote DOM
// Auto-reconnects on disconnect.
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
  getPageMarkdown(selector?: string): Promise<{ markdown: string; length: number } | { error: string }>
  getVisibleText(selector?: string): Promise<{ text: string; length: number } | { error: string }>
  screenshot(selector?: string): Promise<{ data: string; width: number; height: number } | { error: string }>
  click(selector: string): Promise<{ clicked: string; tag: string } | { error: string }>
  fill(selector: string, value: string): Promise<{ filled: string; value: string } | { error: string }>
  subscribeEvents(browserId?: string): Promise<ReadableStream>
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
  /** Convert page/element DOM to markdown with links */
  getPageMarkdown(selector?: string): Promise<{ markdown: string; length: number } | { error: string }>
  /** Get visible text of an element or page */
  getVisibleText(selector?: string): Promise<{ text: string; length: number } | { error: string }>
  /** Take a screenshot, returns base64 PNG */
  screenshot(selector?: string): Promise<{ data: string; width: number; height: number } | { error: string }>
  /** Click an element by CSS selector */
  click(selector: string): Promise<{ clicked: string; tag: string } | { error: string }>
  /** Fill an input by CSS selector */
  fill(selector: string, value: string): Promise<{ filled: string; value: string } | { error: string }>
  /** Subscribe to real-time event stream */
  subscribeEvents(browserId?: string): Promise<ReadableStream>
  /** How many browsers are connected */
  getBrowserCount(): Promise<number>
  /** List connected browsers */
  getBrowserList(): Promise<Array<{ connId: string; browserId: string | null }>>
  /** Close the connection (no auto-reconnect) */
  close(): void
}

function createTransport(ws: WebSocket) {
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

  return {
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
}

export function connect(url: string): Promise<BrowserConnection> {
  let gw: any = null
  let ws: WebSocket | null = null
  let closed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let ready: Promise<void> = Promise.resolve()
  let readyResolve: (() => void) | null = null

  function doConnect(): Promise<void> {
    ready = new Promise(r => { readyResolve = r })
    return new Promise((resolve, reject) => {
      const isFirst = gw === null
      ws = new WebSocket(url)
      ws.on('error', (err) => {
        if (isFirst) reject(err)
        // On reconnect failure, try again
        if (!closed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            doConnect().catch(() => {})
          }, 2000)
        }
      })
      ws.on('open', () => {
        const transport = createTransport(ws!)
        const session = new RpcSession<GatewayStub>(transport)
        gw = session.getRemoteMain()
        readyResolve?.()
        if (isFirst) resolve()
      })
      ws.on('close', () => {
        if (!closed && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            doConnect().catch(() => {})
          }, 2000)
        }
      })
    })
  }

  // Wrap calls to wait for reconnection
  async function whenReady<T>(fn: () => T): Promise<Awaited<T>> {
    await ready
    return fn() as any
  }

  return doConnect().then(() => ({
    get document() { return gw.document },
    get window() { return gw.window },
    navigate: (u: string) => whenReady(() => gw.navigate(u)),
    getPageMarkdown: (s?: string) => whenReady(() => gw.getPageMarkdown(s)),
    getVisibleText: (s?: string) => whenReady(() => gw.getVisibleText(s)),
    screenshot: (s?: string) => whenReady(() => gw.screenshot(s)),
    click: (s: string) => whenReady(() => gw.click(s)),
    fill: (s: string, v: string) => whenReady(() => gw.fill(s, v)),
    subscribeEvents: (b?: string) => whenReady(() => gw.subscribeEvents(b)),
    getBrowserCount: () => whenReady(() => gw.getBrowserCount()),
    getBrowserList: () => whenReady(() => gw.getBrowserList()),
    close: () => { closed = true; ws?.close() },
  }))
}
