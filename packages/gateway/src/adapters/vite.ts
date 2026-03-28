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

const VIRTUAL_MODULE_ID = 'virtual:web-dev-mcp-client'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

export interface ViteAdapterOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
}

function registerWithGateway(
  gatewayUrl: string,
  config: ResolvedConfig,
): Promise<{ serverId: string; logDir: string } | null> {
  const body = JSON.stringify({
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
      ;(config.server as any).forwardConsole = false
    },

    async configureServer(server) {
      // Register with gateway (non-blocking — adapter works without it)
      if (resolvedConfig) {
        const result = await registerWithGateway(gatewayUrl, resolvedConfig).catch(() => null)
        if (result) {
          serverId = result.serverId
          console.log(`  [web-dev-mcp] Registered with gateway (server: ${serverId}, logs: ${result.logDir})`)
        }
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

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        // Virtual module sets gateway origin + server ID and loads client.js via script tag
        let code = `window.__WEB_DEV_MCP_ORIGIN__ = ${JSON.stringify(gatewayUrl)};\n`
        if (serverId) {
          code += `window.__WEB_DEV_MCP_SERVER__ = ${JSON.stringify(serverId)};\n`
        }
        code += `
if (!window.__WEB_DEV_MCP_LOADED__) {
  const s = document.createElement('script');
  s.src = '/__client.js';
  document.head.appendChild(s);
}
`
        return code
      }
    },

    transform(code, id) {
      if (!id.endsWith('.tsx') && !id.endsWith('.ts') && !id.endsWith('.jsx') && !id.endsWith('.js')) {
        return
      }
      if (
        code.includes('createRoot') ||
        code.includes('ReactDOM.render') ||
        code.includes('hydrateRoot')
      ) {
        if (code.includes(VIRTUAL_MODULE_ID)) return
        return {
          code: `import '${VIRTUAL_MODULE_ID}';\n${code}`,
          map: null,
        }
      }
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
