// Next.js adapter for web-dev-mcp
// Wraps next.config to inject gateway registration, console capture, build events, and rewrites

import {
  ensureGateway,
  registerWithRetry,
  patchConsole,
  connectDevEvents,
  setInternalLogging,
  type DevEventsHandle,
} from '@winstonfassett/web-dev-mcp-gateway/helpers'

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

let _devEvents: DevEventsHandle | null = null

function sendBuildEvent(payload: any) {
  _devEvents?.send(payload)
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

  const serverId = String(process.pid)
  process.env.__WEB_DEV_MCP_SERVER__ = serverId

  // Auto-start gateway, then register + capture console + dev events
  ensureGateway(gatewayUrl).then(async () => {
    await patchConsole(gatewayUrl, serverId)
    _devEvents = await connectDevEvents(gatewayUrl, serverId)

    registerWithRetry(gatewayUrl, {
      id: serverId,
      type: 'nextjs',
      port: parseInt(process.env.PORT || '3000', 10),
      pid: process.pid,
      directory: process.cwd(),
    })
  })

  return {
    ...nextConfig,

    // Expose env vars to browser — works with both webpack and Turbopack
    env: {
      ...nextConfig.env,
      NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY: gatewayUrl,
      NEXT_PUBLIC_WEB_DEV_MCP_SERVER: serverId,
    },

    webpack(config: any, webpackOptions: any) {
      const { dev, isServer } = webpackOptions

      if (dev) {
        config.plugins = config.plugins || []
        config.plugins.push(new WebDevMcpBuildPlugin())
      }

      // Inject client instrumentation in dev client bundles (webpack mode only)
      if (dev && !isServer) {
        const originalEntry = config.entry

        config.entry = async () => {
          const entries = await originalEntry()

          Object.keys(entries).forEach((key) => {
            const entry = entries[key]
            if (Array.isArray(entry) && !entry.includes('@winstonfassett/web-dev-mcp-nextjs/instrument')) {
              entries[key] = ['@winstonfassett/web-dev-mcp-nextjs/instrument', ...entry]
            }
          })

          return entries
        }

        config.plugins = config.plugins || []
        const webpack = config.plugins[0]?.constructor
        if (webpack && webpack.DefinePlugin) {
          config.plugins.push(
            new webpack.DefinePlugin({
              'process.env.__WEB_DEV_MCP_GATEWAY__': JSON.stringify(gatewayUrl),
              'process.env.__WEB_DEV_MCP_NETWORK__': JSON.stringify(network),
              'process.env.__WEB_DEV_MCP_SERVER__': JSON.stringify(serverId),
            })
          )
        }
      }

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

      const normalized = Array.isArray(userRewrites)
        ? { beforeFiles: userRewrites, afterFiles: [], fallback: [] }
        : userRewrites

      const mcpRewrites = [
        { source: '/__mcp/:path*', destination: `${gatewayUrl}/__mcp/:path*` },
        { source: '/__rpc', destination: `${gatewayUrl}/__rpc` },
        { source: '/__events', destination: `${gatewayUrl}/__events` },
        { source: '/__client.js', destination: `${gatewayUrl}/__client.js` },
      ]

      return {
        beforeFiles: [...(normalized.beforeFiles || []), ...mcpRewrites],
        afterFiles: normalized.afterFiles || [],
        fallback: normalized.fallback || [],
      }
    },
  }
}
