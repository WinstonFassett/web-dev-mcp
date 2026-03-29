// Vite adapter for web-dev-mcp
// Injects client code via Vite's transform hook, forwards HMR/build events to gateway

import type { Plugin, HotUpdateOptions, EnvironmentModuleNode, ResolvedConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureGateway,
  registerWithRetry,
  patchConsole,
  connectDevEvents,
  type RegistrationPayload,
  type DevEventsHandle,
} from '@winstonfassett/web-dev-mcp-gateway/helpers'

export interface ViteAdapterOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
  serverType?: 'vite' | 'storybook' | 'generic'
}

export function webDevMcp(options: ViteAdapterOptions = {}): Plugin {
  const gatewayUrl = options.gateway ?? 'http://localhost:3333'
  let clientSource: string | undefined
  let devEvents: DevEventsHandle | null = null
  let serverId: string | null = null
  let resolvedConfig: ResolvedConfig | null = null

  return {
    name: 'web-dev-mcp',
    apply: 'serve',

    configResolved(config) {
      resolvedConfig = config
      serverId = String(process.pid)
      ;(config.server as any).forwardConsole = false
    },

    async configureServer(server) {
      // Auto-start gateway if not running
      await ensureGateway(gatewayUrl)

      // Start console capture immediately
      await patchConsole(gatewayUrl, serverId!)

      // Register with gateway (retry loop)
      const payload: RegistrationPayload = {
        id: serverId!,
        type: options.serverType ?? 'vite',
        port: resolvedConfig!.server.port ?? 5173,
        pid: process.pid,
        directory: resolvedConfig!.root,
      }
      registerWithRetry(gatewayUrl, payload)

      // Connect dev events WebSocket
      devEvents = await connectDevEvents(gatewayUrl, serverId!)

      // Serve gateway's bundled client.js at /__client.js
      const clientPath = resolveClientPath()
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__client.js') {
          if (!clientSource) {
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
      let initScript = `window.__WEB_DEV_MCP_ORIGIN__ = ${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `\nwindow.__WEB_DEV_MCP_SERVER__ = ${JSON.stringify(serverId)};`
      }
      return [
        { tag: 'script', children: initScript, injectTo: 'head-prepend' as const },
        { tag: 'script', attrs: { src: '/__client.js' }, injectTo: 'head-prepend' as const },
      ]
    },

    hotUpdate(opts: HotUpdateOptions) {
      if (opts.modules.length > 0) {
        devEvents?.send({
          type: 'build:update',
          modules: opts.modules.map((m: EnvironmentModuleNode) => m.id ?? m.url),
        })
      }
    },
  }
}

function resolveClientPath(): string {
  // client.js is bundled in the gateway package's dist/
  try {
    const gatewayPkg = import.meta.resolve('@winstonfassett/web-dev-mcp-gateway')
    const gatewayDir = new URL('.', gatewayPkg).pathname
    return join(gatewayDir, 'client.js')
  } catch {
    // Fallback for workspace/linked setups
    return join(process.cwd(), 'node_modules', '@winstonfassett', 'web-dev-mcp-gateway', 'dist', 'client.js')
  }
}
