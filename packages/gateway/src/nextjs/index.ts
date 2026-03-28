// Type definitions for Next.js config (to avoid requiring 'next' as dependency)
interface NextConfig {
  webpack?: (config: any, options: any) => any
  rewrites?: () => Promise<any> | any
  [key: string]: any
}

export interface WebDevMcpOptions {
  gatewayUrl?: string
  enabled?: boolean
  network?: boolean
}

// Guard: true while our own code is logging (prevents infinite recursion)
let _internalLogging = false

function registerAndPatchConsole(gatewayUrl: string) {
  const body = JSON.stringify({
    type: 'nextjs',
    port: parseInt(process.env.PORT || '3000', 10),
    pid: process.pid,
    directory: process.cwd(),
  })

  // Fire-and-forget — adapter works without gateway running
  fetch(`${gatewayUrl}/__gateway/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then((res) => res.json()).then((data) => {
    if (data.success) {
      _internalLogging = true
      console.log(`  [web-dev-mcp] Registered with gateway (server: ${data.serverId}, logs: ${data.logDir})`)
      _internalLogging = false

      // Set server ID for browser client to pick up
      process.env.__WEB_DEV_MCP_SERVER__ = data.serverId

      // Start server-side console capture + build events
      patchConsole(gatewayUrl, data.serverId)
      connectDevEvents(gatewayUrl, data.serverId)
    }
  }).catch(() => {
    // Gateway not running — that's fine
  })
}

async function patchConsole(gatewayUrl: string, serverId: string) {
  let WS: any
  try {
    WS = (await import('ws')).default
  } catch {
    return // ws not available
  }

  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__events?server=' + encodeURIComponent(serverId)
  let ws: any = null
  let queue: string[] = []
  let closed = false

  function connect() {
    if (closed) return
    ws = new WS(wsUrl)

    ws.on('open', () => {
      for (const msg of queue) ws.send(msg)
      queue = []
    })
    ws.on('close', () => {
      ws = null
      if (!closed) setTimeout(connect, 2000)
    })
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
    if (ws?.readyState === 1) {
      ws.send(msg)
    } else if (queue.length < 1000) {
      queue.push(msg)
    }
  }

  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    const orig = console[level]
    console[level] = (...args: any[]) => {
      // Always call original first
      orig.apply(console, args)

      // Guard: skip our own internal logs + skip if first arg starts with known prefixes
      if (_internalLogging) return
      const first = args[0]
      if (typeof first === 'string' && (first.startsWith('[web-dev-mcp]') || first.startsWith('  [web-dev-mcp]') || first.startsWith('[registry]'))) return

      send(level, args)
    }
  }

  // Cleanup on process exit
  process.on('exit', () => { closed = true; ws?.close() })
}

// --- Dev events (build/HMR) ---

let _devEventsWs: any = null
let _devEventsQueue: string[] = []

async function connectDevEvents(gatewayUrl: string, sid: string) {
  let WS: any
  try { WS = (await import('ws')).default } catch { return }

  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__dev-events?server=' + encodeURIComponent(sid)
  let closed = false

  function connect() {
    if (closed) return
    _devEventsWs = new WS(wsUrl)
    _devEventsWs.on('open', () => { for (const msg of _devEventsQueue) _devEventsWs.send(msg); _devEventsQueue = [] })
    _devEventsWs.on('close', () => { _devEventsWs = null; if (!closed) setTimeout(connect, 2000) })
    _devEventsWs.on('error', () => {})
  }
  connect()

  process.on('exit', () => { closed = true; _devEventsWs?.close() })
}

function sendBuildEvent(payload: any) {
  const msg = JSON.stringify(payload)
  if (_devEventsWs?.readyState === 1) _devEventsWs.send(msg)
  else if (_devEventsQueue.length < 100) _devEventsQueue.push(msg)
}

/** Webpack plugin that sends build events to the gateway */
class WebDevMcpBuildPlugin {
  apply(compiler: any) {
    compiler.hooks.compile.tap('WebDevMcpBuild', () => {
      sendBuildEvent({ type: 'build:start' })
    })

    compiler.hooks.done.tap('WebDevMcpBuild', (stats: any) => {
      if (stats.hasErrors()) {
        const errors = stats.toJson({ errors: true }).errors
        const msg = errors?.[0]?.message ?? 'Build error'
        sendBuildEvent({ type: 'build:error', error: msg })
      } else {
        const modules = Object.keys(stats.toJson({ assets: false, modules: true }).modules ?? {}).slice(0, 20)
        sendBuildEvent({ type: 'build:update', modules, duration: stats.endTime - stats.startTime })
      }
    })
  }
}

export function withWebDevMcp(
  nextConfig: NextConfig = {},
  options: WebDevMcpOptions = {}
): NextConfig {
  const {
    gatewayUrl = 'http://localhost:3333',
    enabled = process.env.NODE_ENV === 'development',
    network = false,
  } = options

  if (!enabled) {
    return nextConfig
  }

  // Register with gateway and patch console at config load time (dev server startup)
  registerAndPatchConsole(gatewayUrl)

  return {
    ...nextConfig,

    webpack(config: any, webpackOptions: any) {
      const { dev, isServer } = webpackOptions

      // Add build event plugin (both client and server compilations)
      if (dev) {
        config.plugins = config.plugins || []
        config.plugins.push(new WebDevMcpBuildPlugin())
      }

      // Only inject client instrumentation in development client bundles
      if (dev && !isServer) {
        const originalEntry = config.entry

        config.entry = async () => {
          const entries = await originalEntry()

          // Inject our instrument file at the start of each entry
          Object.keys(entries).forEach((key) => {
            const entry = entries[key]
            if (Array.isArray(entry) && !entry.includes('web-dev-mcp-gateway/nextjs/instrument')) {
              entries[key] = ['web-dev-mcp-gateway/nextjs/instrument', ...entry]
            }
          })

          return entries
        }

        // Pass options to the instrument file via webpack DefinePlugin
        // Use dynamic import to avoid require() in ES modules
        config.plugins = config.plugins || []
        const webpack = config.plugins[0]?.constructor // Get webpack from existing plugin
        if (webpack && webpack.DefinePlugin) {
          config.plugins.push(
            new webpack.DefinePlugin({
              'process.env.__WEB_DEV_MCP_GATEWAY__': JSON.stringify(gatewayUrl),
              'process.env.__WEB_DEV_MCP_NETWORK__': JSON.stringify(network),
            })
          )
        }
      }

      // Call user's webpack function if it exists
      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, webpackOptions)
      }

      return config
    },

    async rewrites() {
      const userRewrites =
        typeof nextConfig.rewrites === 'function'
          ? await nextConfig.rewrites()
          : { beforeFiles: [], afterFiles: [], fallback: [] }

      // Normalize rewrites to object format
      const normalized = Array.isArray(userRewrites)
        ? { beforeFiles: userRewrites, afterFiles: [], fallback: [] }
        : userRewrites

      // Add our gateway proxies
      const mcpRewrites = [
        {
          source: '/__mcp/:path*',
          destination: `${gatewayUrl}/__mcp/:path*`,
        },
        {
          source: '/__rpc',
          destination: `${gatewayUrl}/__rpc`,
        },
        {
          source: '/__events',
          destination: `${gatewayUrl}/__events`,
        },
        {
          source: '/__client.js',
          destination: `${gatewayUrl}/__client.js`,
        },
      ]

      return {
        beforeFiles: [...(normalized.beforeFiles || []), ...mcpRewrites],
        afterFiles: normalized.afterFiles || [],
        fallback: normalized.fallback || [],
      }
    },
  }
}
