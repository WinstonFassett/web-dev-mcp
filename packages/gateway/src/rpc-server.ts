// Browser command WebSocket — simple JSON protocol
//
// Gateway → Browser: { id, method, params }
// Browser → Gateway: { id, result } | { id, error }

import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'
import type { ServerRegistry } from './registry.js'
import { queryLogs } from './log-reader.js'

// --- Command protocol types ---

interface PendingCommand {
  resolve: (result: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface BrowserConnection {
  ws: WsWebSocket
  browserId: string | null
  serverId: string | null
  connectedAt: number
  pending: Map<string, PendingCommand>
  nextId: number
}

const browsers = new Map<string, BrowserConnection>()
const connectionOrder: string[] = []

// Hooks for external listeners (admin UI, etc)
type BrowserEventCallback = (event: 'connect' | 'disconnect', data: { connId: string; browserId: string | null; serverId: string | null }) => void
const browserEventListeners: Set<BrowserEventCallback> = new Set()
export function onBrowserEvent(cb: BrowserEventCallback) {
  browserEventListeners.add(cb)
  return () => browserEventListeners.delete(cb)
}

// Log event hook — gateway calls this when browser events arrive
type LogEventCallback = (data: { channel: string; payload: any; browserId?: string }) => void
const logEventListeners: Set<LogEventCallback> = new Set()
export function onLogEvent(cb: LogEventCallback) {
  logEventListeners.add(cb)
  return () => logEventListeners.delete(cb)
}
export function emitLogEvent(data: { channel: string; payload: any; browserId?: string }) {
  for (const cb of logEventListeners) cb(data)
}

/** Send a command to a browser and wait for the response */
function sendCommand(conn: BrowserConnection, method: string, params?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (conn.ws.readyState !== 1 /* OPEN */) {
      reject(new Error('Browser WebSocket not open'))
      return
    }

    const id = String(++conn.nextId)
    const timer = setTimeout(() => {
      conn.pending.delete(id)
      reject(new Error(`Command ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.pending.set(id, { resolve, reject, timer })
    conn.ws.send(JSON.stringify({ id, method, params }))
  })
}

/** Get the latest browser connection, optionally filtered by serverId */
function getBrowserConnection(serverId?: string): BrowserConnection | undefined {
  if (serverId) {
    for (let i = connectionOrder.length - 1; i >= 0; i--) {
      const conn = browsers.get(connectionOrder[i])
      if (conn?.serverId === serverId) return conn
    }
    return undefined
  }
  if (connectionOrder.length === 0) return undefined
  const connId = connectionOrder[connectionOrder.length - 1]
  return browsers.get(connId)
}

/** Public API: send a command to a browser by serverId */
export function browserCommand(serverId: string | undefined, method: string, params?: any, timeoutMs?: number): Promise<any> {
  const conn = getBrowserConnection(serverId)
  if (!conn) {
    const all = getAllBrowsers()
    const details = all.length > 0
      ? ` (${all.length} browser(s) connected with servers: ${all.map(b => b.serverId ?? 'untagged').join(', ')})`
      : ' (no browsers connected)'
    return Promise.reject(new Error(
      serverId
        ? `No browser connected for server ${serverId}${details}`
        : `No browser connected${details}`
    ))
  }
  return sendCommand(conn, method, params, timeoutMs)
}

/** Disconnect and remove all browsers associated with a given serverId */
export function removeBrowsersByServer(serverId: string): number {
  let removed = 0
  for (const [connId, conn] of browsers) {
    if (conn.serverId === serverId) {
      // Reject all pending commands
      for (const [, pending] of conn.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Browser disconnected'))
      }
      conn.pending.clear()
      conn.ws.close()
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
      console.log(`[web-dev-mcp] Browser evicted (${connId}) — server ${serverId} removed`)
      for (const cb of browserEventListeners) cb('disconnect', { connId, browserId: conn.browserId, serverId })
      removed++
    }
  }
  return removed
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

  wss.on('connection', (ws, request: any) => {
    const connId = Math.random().toString(36).slice(2)

    // Parse server ID from query parameter (for hybrid mode)
    let serverId: string | null = null
    const url = request.url ?? ''
    const match = url.match(/[?&]server=([^&]+)/)
    if (match) {
      serverId = decodeURIComponent(match[1])
    }

    const conn: BrowserConnection = {
      ws,
      browserId: null,
      serverId,
      connectedAt: Date.now(),
      pending: new Map(),
      nextId: 0,
    }

    browsers.set(connId, conn)
    connectionOrder.push(connId)

    // Handle responses from browser
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())

        // Response to a pending command
        if (msg.id && conn.pending.has(msg.id)) {
          const pending = conn.pending.get(msg.id)!
          conn.pending.delete(msg.id)
          clearTimeout(pending.timer)
          if (msg.error) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
          return
        }

        // Unsolicited message from browser (e.g. browserId announcement)
        if (msg.type === 'init' && msg.browserId) {
          conn.browserId = msg.browserId
        }
      } catch {
        // Ignore malformed messages
      }
    })

    const serverInfo = serverId ? ` for server ${serverId}` : ''
    console.log(`[web-dev-mcp] Browser connected (${connId})${serverInfo}`)
    for (const cb of browserEventListeners) cb('connect', { connId, browserId: conn.browserId, serverId })

    ws.on('close', () => {
      // Reject all pending commands
      for (const [, pending] of conn.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Browser disconnected'))
      }
      conn.pending.clear()

      const bid = conn.browserId
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
      console.log(`[web-dev-mcp] Browser disconnected (${connId})`)
      for (const cb of browserEventListeners) cb('disconnect', { connId, browserId: bid, serverId })
    })
  })

  return wss
}
