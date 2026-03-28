// Vite adapter for web-dev-mcp
// Injects client code natively via Vite's transform hook (no proxy needed)
// Forwards HMR/build events to gateway's /__dev-events WebSocket

import type { Plugin, HotUpdateOptions, EnvironmentModuleNode, ResolvedConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))

export interface ViteAdapterOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
}

function registerWithGateway(
  gatewayUrl: string,
  config: ResolvedConfig,
  serverId: string,
): Promise<{ serverId: string; logDir: string } | null> {
  const body = JSON.stringify({
    id: serverId,
    type: 'vite',
    port: config.server.port ?? 5173,
    pid: process.pid,
    directory: config.root,
  })
  return new Promise((resolve) => {
    const url = new URL('/__gateway/register', gatewayUrl)
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.success) {
            resolve({ serverId: json.serverId, logDir: json.logDir })
          } else {
            resolve(null)
          }
        } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.end(body)
  })
}

// Guard: true while our own code is logging (prevents infinite recursion)
let _internalLogging = false

function patchConsole(gatewayUrl: string, sid: string) {
  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__events?server=' + encodeURIComponent(sid)
  let ws: WebSocket | null = null
  let queue: string[] = []
  let closed = false

  function connect() {
    if (closed) return
    ws = new WebSocket(wsUrl)
    ws.on('open', () => { for (const msg of queue) ws!.send(msg); queue = [] })
    ws.on('close', () => { ws = null; if (!closed) setTimeout(connect, 2000) })
    ws.on('error', () => {})
  }
  connect()

  function send(level: string, args: any[]) {
    const serialized = args.map(a => {
      if (typeof a === 'string') return a.slice(0, 2000)
      try { return JSON.stringify(a).slice(0, 2000) } catch { return String(a).slice(0, 2000) }
    })
    const msg = JSON.stringify({
      channel: 'server-console',
      payload: { level, args: serialized, source: 'server' },
    })
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg)
    else if (queue.length < 1000) queue.push(msg)
  }

  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    const orig = console[level]
    console[level] = (...args: any[]) => {
      orig.apply(console, args)
      if (_internalLogging) return
      const first = args[0]
      if (typeof first === 'string' && (first.startsWith('[web-dev-mcp]') || first.startsWith('  [web-dev-mcp]') || first.startsWith('[registry]'))) return
      send(level, args)
    }
  }

  process.on('exit', () => { closed = true; ws?.close() })
}

export function webDevMcp(options: ViteAdapterOptions = {}): Plugin {
  const gatewayUrl = options.gateway ?? 'http://localhost:3333'
  let clientSource: string | undefined
  let devEventsWs: WebSocket | null = null
  let serverId: string | null = null
  let resolvedConfig: ResolvedConfig | null = null

  let gatewayWarned = false

  function connectDevEvents() {
    let wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__dev-events'
    if (serverId) wsUrl += `?server=${encodeURIComponent(serverId)}`
    devEventsWs = new WebSocket(wsUrl)

    devEventsWs.on('open', () => {
      if (gatewayWarned) {
        console.log(`  [web-dev-mcp] Gateway connected at ${gatewayUrl}`)
        gatewayWarned = false
      }
    })

    devEventsWs.on('close', () => {
      devEventsWs = null
      setTimeout(connectDevEvents, 3000)
    })

    devEventsWs.on('error', () => {
      if (!gatewayWarned) {
        console.warn(`  [web-dev-mcp] Gateway not running. Start it with: npx web-dev-mcp-gateway`)
        gatewayWarned = true
      }
    })
  }

  function sendBuildEvent(payload: any) {
    if (devEventsWs && devEventsWs.readyState === WebSocket.OPEN) {
      devEventsWs.send(JSON.stringify(payload))
    }
  }

  return {
    name: 'web-dev-mcp',
    apply: 'serve',

    configResolved(config) {
      resolvedConfig = config
      // Compute server ID locally — always available, no async needed
      serverId = String(process.pid)
      ;(config.server as any).forwardConsole = false
    },

    async configureServer(server) {
      // serverId already set in configResolved — start console capture immediately
      patchConsole(gatewayUrl, serverId!)

      // Register with gateway — retry if gateway isn't up yet
      let registered = false
      let retryTimer: ReturnType<typeof setInterval> | null = null

      async function tryRegister() {
        if (!resolvedConfig || registered) return
        const result = await registerWithGateway(gatewayUrl, resolvedConfig, serverId!).catch(() => null)
        if (result) {
          registered = true
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null }
          _internalLogging = true
          console.log(`  [web-dev-mcp] Registered with gateway (server: ${serverId}, logs: ${result.logDir})`)
          _internalLogging = false
        }
      }

      await tryRegister()
      if (!registered) {
        retryTimer = setInterval(tryRegister, 5000)
      }

      connectDevEvents()

      // Serve gateway's bundled client.js at /__client.js
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__client.js') {
          if (!clientSource) {
            const clientPath = join(__dirname, '..', 'client.js')
            clientSource = readFileSync(clientPath, 'utf-8')
          }
          res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
          res.end(clientSource)
          return
        }
        next()
      })
    },

    transformIndexHtml() {
      // Inject client setup + script into every HTML entry — framework-agnostic
      let initScript = `window.__WEB_DEV_MCP_ORIGIN__ = ${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `\nwindow.__WEB_DEV_MCP_SERVER__ = ${JSON.stringify(serverId)};`
      }
      return [
        { tag: 'script', children: initScript, injectTo: 'head-prepend' },
        { tag: 'script', attrs: { src: '/__client.js' }, injectTo: 'head-prepend' },
      ]
    },

    hotUpdate(opts: HotUpdateOptions) {
      if (opts.modules.length > 0) {
        sendBuildEvent({
          type: 'build:update',
          modules: opts.modules.map((m: EnvironmentModuleNode) => m.id ?? m.url),
        })
      }
    },
  }
}
