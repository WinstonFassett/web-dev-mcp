// CDP endpoint server for Playwright connectOverCDP compatibility
// Exposes Chobitsu (in-browser CDP) to external tools via standard CDP protocol

import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'
import { RpcTarget } from 'capnweb'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  getBrowserByAlias,
  getBrowserById,
  getAllBrowsers,
  waitForBrowser,
  type BrowserStub,
} from './rpc-server.js'
import type { RpcStub } from 'capnweb'

const CDP_PATH = '/__cdp'

// CDP callback target — receives CDP messages from browser and forwards to WebSocket
class CdpCallback extends RpcTarget {
  #ws: WsWebSocket

  constructor(ws: WsWebSocket) {
    super()
    this.#ws = ws
  }

  send(message: string) {
    if (this.#ws.readyState === this.#ws.OPEN) {
      try {
        const parsed = JSON.parse(message)
        console.log('[CDP] ← (from browser)', parsed.method || `response:${parsed.id}`)
      } catch {
        console.log('[CDP] ← (from browser, unparsed)', message.slice(0, 100))
      }
      this.#ws.send(message)
    }
  }
}

interface CdpConnection {
  ws: WsWebSocket
  browser: RpcStub<BrowserStub>
  callback: CdpCallback
}

const cdpConnections = new Map<WsWebSocket, CdpConnection>()

export interface CdpContext {
  serverUrl: string
}

// Handle Target domain commands that Playwright expects but Chobitsu doesn't implement
// Returns response JSON if handled, undefined to forward to browser
function handleTargetDomain(
  msg: { id: number; method: string; params?: any },
  browser: RpcStub<BrowserStub>,
  browserId: string,
): object | undefined {
  const { id, method, params } = msg

  switch (method) {
    case 'Target.setDiscoverTargets':
      // Playwright wants to discover targets - just acknowledge
      return { id, result: {} }

    case 'Target.getBrowserContexts':
      // Return empty list - we don't support multiple contexts
      return { id, result: { browserContextIds: [] } }

    case 'Target.getTargets':
      // Return our single page target
      return {
        id,
        result: {
          targetInfos: [{
            targetId: browserId,
            type: 'page',
            title: 'Page',
            url: '',
            attached: true,
            browserContextId: '',
          }],
        },
      }

    case 'Target.createBrowserContext':
      // Create a fake context ID
      return { id, result: { browserContextId: 'ctx-' + Date.now() } }

    case 'Target.disposeBrowserContext':
      return { id, result: {} }

    case 'Target.attachToTarget':
      // Auto-attach - just acknowledge. Messages will be flattened (no sessionId routing)
      return { id, result: { sessionId: params?.targetId || browserId } }

    case 'Target.setAutoAttach':
      return { id, result: {} }

    case 'Target.attachToBrowserTarget':
      return { id, result: { sessionId: 'browser' } }

    case 'Target.getTargetInfo':
      return {
        id,
        result: {
          targetInfo: {
            targetId: params?.targetId || browserId,
            type: 'page',
            title: 'Page',
            url: '',
            attached: true,
            browserContextId: '',
          },
        },
      }

    case 'Target.createTarget':
      // Can't create new targets - return the existing one
      return {
        id,
        result: { targetId: browserId },
      }

    case 'Target.closeTarget':
      return { id, result: { success: false } }

    case 'Browser.getVersion':
      return {
        id,
        result: {
          protocolVersion: '1.3',
          product: 'vite-live-dev-mcp/1.0',
          revision: '0',
          userAgent: 'vite-live-dev-mcp',
          jsVersion: '0',
        },
      }

    case 'Browser.setDownloadBehavior':
      return { id, result: {} }

    case 'Browser.getWindowForTarget':
      return { id, result: { windowId: 1, bounds: { left: 0, top: 0, width: 1280, height: 720, windowState: 'normal' } } }

    case 'Browser.setWindowBounds':
      return { id, result: {} }

    default:
      // Not a Target/Browser command we handle - forward to browser
      return undefined
  }
}

export function createCdpMiddleware(ctx: CdpContext) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''

    if (!url.startsWith(CDP_PATH)) {
      return next()
    }

    const path = url.slice(CDP_PATH.length)

    // Normalize: strip trailing slash
    const normalizedPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path

    // GET / or /json/version — CDP version info (Playwright fetches base URL directly)
    if ((normalizedPath === '' || normalizedPath === '/' || normalizedPath === '/json/version') && req.method === 'GET') {
      const wsUrl = ctx.serverUrl ? ctx.serverUrl.replace('http', 'ws') : 'ws://localhost:5173'
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        Browser: 'vite-live-dev-mcp/1.0',
        'Protocol-Version': '1.3',
        'User-Agent': 'vite-live-dev-mcp',
        'V8-Version': '0.0.0',
        'WebKit-Version': '0.0.0',
        webSocketDebuggerUrl: `${wsUrl}${CDP_PATH}/devtools/browser`,
      }))
      return
    }

    // GET /json/protocol — protocol schema (stub)
    if (normalizedPath === '/json/protocol' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ domains: [] }))
      return
    }

    // GET /json or /json/list — list available pages
    if ((normalizedPath === '/json' || normalizedPath === '/json/list') && req.method === 'GET') {
      const wsUrl = ctx.serverUrl ? ctx.serverUrl.replace('http', 'ws') : 'ws://localhost:5173'
      const browsers = getAllBrowsers()
      const pages: any[] = []

      for (const { browserId } of browsers) {
        if (!browserId) continue

        try {
          const stub = getBrowserById(browserId)
          if (!stub) continue

          const info = await stub.getPageInfo()
          pages.push({
            description: '',
            devtoolsFrontendUrl: '',
            id: info.id,
            title: info.title,
            type: info.type,
            url: info.url,
            webSocketDebuggerUrl: `${wsUrl}${CDP_PATH}/devtools/page/${info.id}`,
          })
        } catch {
          // Browser disconnected or error
        }
      }

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(pages))
      return
    }

    // Catch-all for other CDP routes — return JSON 404 to avoid HTML fallthrough
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not found', path: normalizedPath }))
  }
}

export function setupCdpWebSocket(
  httpServer: { on(event: string, listener: (...args: any[]) => void): void },
  _ctx: CdpContext,  // Reserved for future use
) {
  const wss = new WebSocketServer({ noServer: true })

  // Use prependListener to run before Vite's HMR WebSocket handler
  ;(httpServer as any).prependListener('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    const url = request.url ?? ''
    console.log('[CDP] upgrade request:', url)

    // Match /__cdp/devtools/browser or /__cdp/devtools/page/:id
    const browserMatch = url.match(/^\/__cdp\/devtools\/browser\/?$/)
    const pageMatch = url.match(/^\/__cdp\/devtools\/page\/(.+)$/)

    if (!browserMatch && !pageMatch) {
      console.log('[CDP] upgrade: not a CDP path, ignoring')
      return // Let other handlers deal with it
    }
    console.log('[CDP] upgrade: handling CDP connection for', browserMatch ? 'browser' : `page ${pageMatch![1]}`)

    // For browser endpoint, use 'latest' as the target
    const pageId = browserMatch ? 'latest' : pageMatch![1]

    wss.handleUpgrade(request, socket, head, (ws) => {
      console.log('[CDP] WebSocket upgrade complete, setting up connection...')

      // State that will be populated by async setup
      let browser: RpcStub<BrowserStub> | undefined
      let browserId = 'unknown'
      let ready = false
      const messageQueue: string[] = []

      // Install message handler IMMEDIATELY to avoid losing messages
      ws.on('message', (data) => {
        const message = data.toString()

        // Try to parse and check for Target/Browser domain commands
        try {
          const parsed = JSON.parse(message)
          console.log('[CDP] ←', parsed.method || 'response', parsed.id)

          // Target/Browser commands can be handled without browser connection
          if (parsed.method && (parsed.method.startsWith('Target.') || parsed.method.startsWith('Browser.'))) {
            const response = handleTargetDomain(parsed, browser!, browserId)
            if (response) {
              console.log('[CDP] → (handled)', parsed.method)
              ws.send(JSON.stringify(response))
              return
            }
          }

          // Other commands need browser - queue if not ready
          if (!ready) {
            console.log('[CDP] → (queued, browser not ready)')
            messageQueue.push(message)
            return
          }

          console.log('[CDP] → (forward to browser)')
          browser!.cdpSend(message).catch(() => {
            ws.close(1011, 'Browser disconnected')
          })
        } catch {
          console.log('[CDP] ← (unparsed)', message.slice(0, 100))
          if (!ready) {
            messageQueue.push(message)
          } else {
            browser!.cdpSend(message).catch(() => {
              ws.close(1011, 'Browser disconnected')
            })
          }
        }
      })

      // Async setup
      ;(async () => {
        try {
          // Resolve browser stub
          if (pageId === 'first' || pageId === 'latest') {
            browser = getBrowserByAlias(pageId)
            if (!browser) {
              try {
                browser = await waitForBrowser(10000)
              } catch {
                ws.close(1011, 'No browser connected')
                return
              }
            }
          } else {
            browser = getBrowserById(pageId)
            if (!browser) {
              try {
                await waitForBrowser(2000)
                browser = getBrowserById(pageId)
              } catch {
                // Still no browser
              }
            }
          }

          if (!browser) {
            console.log('[CDP] No browser found!')
            ws.close(1011, `Browser ${pageId} not found`)
            return
          }
          console.log('[CDP] Browser stub found, connecting CDP...')

          // Create callback and connect CDP
          const callback = new CdpCallback(ws)
          console.log('[CDP] Calling browser.cdpConnect...')
          await browser.cdpConnect(callback)
          console.log('[CDP] cdpConnect returned')

          // Get browser ID
          if (pageId === 'first' || pageId === 'latest') {
            try {
              browserId = await browser.id
            } catch {
              browserId = 'unknown'
            }
          } else {
            browserId = pageId
          }

          console.log('[CDP] Got browserId:', browserId)
          const conn: CdpConnection = { ws, browser, callback }
          cdpConnections.set(ws, conn)

          // Mark ready and process queued messages
          ready = true
          console.log('[CDP] Connection ready, processing', messageQueue.length, 'queued messages')
          for (const msg of messageQueue) {
            browser.cdpSend(msg).catch(() => {
              ws.close(1011, 'Browser disconnected')
            })
          }
          messageQueue.length = 0
        } catch (err) {
          console.log('[CDP] Setup error:', err)
          ws.close(1011, String(err))
        }
      })()

      ws.on('close', () => {
        if (browser) {
          browser.cdpDisconnect().catch(() => {})
        }
        cdpConnections.delete(ws)
      })

      ws.on('error', () => {
        if (browser) {
          browser.cdpDisconnect().catch(() => {})
        }
        cdpConnections.delete(ws)
      })
    })
  })

  return wss
}
