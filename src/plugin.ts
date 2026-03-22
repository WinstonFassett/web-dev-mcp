import type { Plugin, ViteDevServer, ResolvedConfig, HotUpdateOptions, EnvironmentModuleNode } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { ViteLiveDevMcpOptions } from './types.js'
import type { ConsolePayload, ErrorPayload, NetworkPayload } from './types.js'
import { initSession, type SessionState } from './session.js'
import { ConsoleWriter } from './writers/console.js'
import { HmrWriter } from './writers/hmr.js'
import { ErrorsWriter } from './writers/errors.js'
import { NetworkWriter } from './writers/network.js'
import { createMcpMiddleware, sendNotificationToAll, type McpContext } from './mcp-server.js'
import { autoRegister } from './auto-register.js'
import { setupRpcWebSocket } from './rpc-server.js'
import { createCdpMiddleware, setupCdpWebSocket } from './cdp-server.js'

const VIRTUAL_MODULE_ID = 'virtual:vite-harness-client'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID
const REACT_ADAPTER_MODULE_ID = 'virtual:vite-harness-react-adapter'
const RESOLVED_REACT_ADAPTER_MODULE_ID = '\0' + REACT_ADAPTER_MODULE_ID
const RPC_BROWSER_MODULE_ID = 'virtual:vite-harness-rpc-browser'
const RESOLVED_RPC_BROWSER_MODULE_ID = '\0' + RPC_BROWSER_MODULE_ID

let _clientShimSource: string | undefined
let _reactAdapterSource: string | undefined
let _rpcBrowserSource: string | undefined
const _packageDir = dirname(fileURLToPath(import.meta.url))

function getClientShimSource(): string {
  if (!_clientShimSource) {
    const shimPath = join(_packageDir, '..', 'src', 'client', 'harness-client.ts')
    _clientShimSource = readFileSync(shimPath, 'utf-8')
  }
  return _clientShimSource
}

function getReactAdapterSource(): string {
  if (!_reactAdapterSource) {
    const adapterPath = join(_packageDir, '..', 'src', 'client', 'react-adapter.ts')
    _reactAdapterSource = readFileSync(adapterPath, 'utf-8')
  }
  return _reactAdapterSource
}

function getRpcBrowserSource(): string {
  if (!_rpcBrowserSource) {
    const rpcPath = join(_packageDir, '..', 'src', 'client', 'rpc-browser.ts')
    _rpcBrowserSource = readFileSync(rpcPath, 'utf-8')
  }
  return _rpcBrowserSource
}

export function viteLiveDevMcp(options: ViteLiveDevMcpOptions = {}): Plugin {
  const mcpPath = options.mcpPath ?? '/__mcp'
  const maxFileSizeMb = options.maxFileSizeMb

  let config: ResolvedConfig
  let session: SessionState
  let consoleWriter: ConsoleWriter
  let hmrWriter: HmrWriter
  let errorsWriter: ErrorsWriter
  let networkWriter: NetworkWriter | undefined

  const mcpCtx: McpContext = {
    session: null as unknown as SessionState, // set on listening
    hmrWriter: null as unknown as HmrWriter, // set on listening
    options,
    connectedClients: 0,
  }

  return {
    name: 'vite-live-dev-mcp',
    apply: 'serve',

    configResolved(resolvedConfig) {
      config = resolvedConfig
      ;(config.server as any).forwardConsole = false
    },

    configureServer(server: ViteDevServer) {
      // Shared context for serverUrl (set when listening)
      const cdpCtx = { serverUrl: '' }

      // Register MCP middleware BEFORE Vite's internal middlewares
      const mcpMiddleware = createMcpMiddleware(mcpPath, mcpCtx)
      server.middlewares.use(mcpMiddleware as any)

      // Register CDP middleware early (needs serverUrl from context)
      server.middlewares.use(createCdpMiddleware(cdpCtx) as any)

      // Setup capnweb RPC WebSocket on /__rpc
      if (server.httpServer) {
        setupRpcWebSocket(server.httpServer, '/__rpc')
        // Setup CDP WebSocket (also needs serverUrl but only for /json output)
        setupCdpWebSocket(server.httpServer, cdpCtx)
      }

      // Init session + writers once server is listening (so resolvedUrls is available)
      server.httpServer?.once('listening', () => {
        const serverUrl =
          server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ??
          `http://localhost:${config.server.port ?? 5173}`

        // Set serverUrl in CDP context
        cdpCtx.serverUrl = serverUrl

        session = initSession(config.root, options, config.env?.VITE_VERSION ?? 'unknown', serverUrl, mcpPath)

        consoleWriter = new ConsoleWriter(session.files.console!, maxFileSizeMb)
        hmrWriter = new HmrWriter(session.files.hmr!, maxFileSizeMb)
        errorsWriter = new ErrorsWriter(session.files.errors!, maxFileSizeMb)
        if (options.network) {
          networkWriter = new NetworkWriter(session.files.network!, maxFileSizeMb)
        }

        // Update MCP context with real values
        mcpCtx.session = session
        mcpCtx.hmrWriter = hmrWriter
        mcpCtx.hot = {
          send: (event, data) => server.hot.send(event, data),
          on: (event, cb) => server.hot.on(event, cb as any),
        }

        // Listen for browser events via HMR channel
        server.hot.on('harness:console', (data: ConsolePayload) => {
          consoleWriter.write(data)
        })

        server.hot.on('harness:error', (data: ErrorPayload) => {
          errorsWriter.write(data)
          if (options.notifications !== false) {
            sendNotificationToAll(
              'errors',
              data.message,
              session.files.errors!,
              `tail -5 ${session.files.errors}`,
            )
          }
        })

        if (options.network) {
          server.hot.on('harness:network', (data: NetworkPayload) => {
            networkWriter!.write(data)
          })
        }

        // Auto-register agent configs (off by default)
        if (options.autoRegister === true || (typeof options.autoRegister === 'object')) {
          const registered = autoRegister(config.root, session.info.mcpUrl, options)
          if (options.printUrl !== false) {
            for (const path of registered) {
              config.logger.info(`  ➜  auto-registered: ${path}`)
            }
          }
        }

        if (options.printUrl !== false) {
          config.logger.info(`  ➜  vite-live-dev-mcp: ${session.info.mcpUrl}`)
          config.logger.info(`  ➜  CDP endpoint: ${serverUrl}/__cdp`)
          config.logger.info(`  ➜  log dir: ${session.logDir}`)
        }
      })

      // HMR events (server-side)
      server.hot.on('vite:beforeUpdate', () => {
        if (hmrWriter) hmrWriter.setPending(true)
      })

      server.hot.on('vite:error', (data: { err: { message: string; stack?: string } }) => {
        if (!hmrWriter) return
        hmrWriter.write({
          type: 'error',
          error: data.err?.message ?? 'Unknown HMR error',
        })
        // Also write to errors channel
        if (errorsWriter) {
          errorsWriter.write({
            type: 'hmr-error',
            message: data.err?.message ?? 'Unknown HMR error',
            stack: data.err?.stack,
          })
        }
        if (options.notifications !== false) {
          sendNotificationToAll(
            'hmr',
            data.err?.message ?? 'HMR error',
            session?.files.hmr ?? '',
            session ? `tail -5 ${session.files.hmr}` : '',
          )
        }
      })
    },

    hotUpdate(opts: HotUpdateOptions) {
      if (!hmrWriter) return
      if (opts.modules.length > 0) {
        hmrWriter.write({
          type: 'update',
          modules: opts.modules.map((m: EnvironmentModuleNode) => m.id ?? m.url),
        })
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }
      if (id === REACT_ADAPTER_MODULE_ID) {
        return RESOLVED_REACT_ADAPTER_MODULE_ID
      }
      if (id === RPC_BROWSER_MODULE_ID) {
        return RESOLVED_RPC_BROWSER_MODULE_ID
      }
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        let preamble = ''
        if (options.react) {
          preamble += `globalThis.__HARNESS_REACT__ = true;\n`
        }
        if (options.network) {
          preamble += `globalThis.__HARNESS_NETWORK__ = true;\n`
          if (options.networkOptions?.excludePatterns) {
            preamble += `globalThis.__HARNESS_NETWORK_EXCLUDE__ = ${JSON.stringify(options.networkOptions.excludePatterns)};\n`
          }
        }
        return preamble + getClientShimSource()
      }
      if (id === RESOLVED_REACT_ADAPTER_MODULE_ID) {
        return getReactAdapterSource()
      }
      if (id === RESOLVED_RPC_BROWSER_MODULE_ID) {
        return getRpcBrowserSource()
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
  }
}
