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

  return {
    ...nextConfig,

    webpack(config: any, webpackOptions: any) {
      const { dev, isServer } = webpackOptions

      // Only inject in development and client-side bundles
      if (dev && !isServer) {
        const originalEntry = config.entry

        config.entry = async () => {
          const entries = await originalEntry()

          // Inject our instrument file at the start of each entry
          Object.keys(entries).forEach((key) => {
            const entry = entries[key]
            if (Array.isArray(entry) && !entry.includes('web-dev-mcp/nextjs/instrument')) {
              entries[key] = ['web-dev-mcp/nextjs/instrument', ...entry]
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
