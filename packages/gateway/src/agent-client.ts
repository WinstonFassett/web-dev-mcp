// Agent client — connect to gateway, get project-scoped browser handles
// Auto-reconnects on disconnect.
//
// Usage:
//   import { connect } from 'web-dev-mcp-gateway/agent'
//   const gw = await connect('ws://localhost:3333/__rpc/agent')
//   const browser = gw.getProject()          // latest project
//   const title = await browser.document.title
//   await browser.click('a')
//   gw.close()

import { RpcSession } from 'capnweb'
import WebSocket from 'ws'

interface GatewayStub {
  getBrowserCount(): Promise<number>
  getBrowserList(): Promise<Array<{ connId: string; browserId: string | null; serverId: string | null }>>
  listProjects(): Promise<string[]>
  getProject(serverId?: string): any  // Returns ProjectBrowserApi stub
  subscribeEvents(browserId?: string): Promise<ReadableStream>
}

export interface BrowserHandle {
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
}

export interface GatewayConnection {
  /** How many browsers are connected */
  getBrowserCount(): Promise<number>
  /** List connected browsers */
  getBrowserList(): Promise<Array<{ connId: string; browserId: string | null; serverId: string | null }>>
  /** List registered project server IDs */
  listProjects(): Promise<string[]>
  /** Get a project-scoped browser handle. No arg = latest project. */
  getProject(serverId?: string): BrowserHandle
  /** Subscribe to real-time event stream */
  subscribeEvents(browserId?: string): Promise<ReadableStream>
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

function makeBrowserHandle(getStub: () => any, whenReady: <T>(fn: () => T) => Promise<Awaited<T>>): BrowserHandle {
  return {
    get document() { return getStub().document },
    get window() { return getStub().window },
    navigate: (u: string) => whenReady(() => getStub().navigate(u)),
    getPageMarkdown: (s?: string) => whenReady(() => getStub().getPageMarkdown(s)),
    getVisibleText: (s?: string) => whenReady(() => getStub().getVisibleText(s)),
    screenshot: (s?: string) => whenReady(() => getStub().screenshot(s)),
    click: (s: string) => whenReady(() => getStub().click(s)),
    fill: (s: string, v: string) => whenReady(() => getStub().fill(s, v)),
  }
}

export function connect(url: string): Promise<GatewayConnection> {
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

  // Cache project handles so repeated getProject() calls reuse the same stub
  const projectCache = new Map<string, BrowserHandle>()

  return doConnect().then((): GatewayConnection => ({
    getBrowserCount: () => whenReady(() => gw.getBrowserCount()),
    getBrowserList: () => whenReady(() => gw.getBrowserList()),
    listProjects: () => whenReady(() => gw.listProjects()),
    getProject(serverId?: string) {
      const key = serverId ?? '__latest__'
      let handle = projectCache.get(key)
      if (!handle) {
        // Get the remote ProjectBrowserApi stub — live reference via getter
        handle = makeBrowserHandle(
          () => gw.getProject(serverId),
          whenReady,
        )
        projectCache.set(key, handle)
      }
      return handle
    },
    subscribeEvents: (b?: string) => whenReady(() => gw.subscribeEvents(b)),
    close: () => { closed = true; ws?.close() },
  }))
}
