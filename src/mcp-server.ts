import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { SessionState } from './session.js'
import { truncateChannelFiles } from './session.js'
import type { HmrWriter } from './writers/hmr.js'
import type { ViteLiveDevMcpOptions } from './types.js'

export interface HotChannel {
  send(event: string, data: unknown): void
  on(event: string, cb: (data: unknown) => void): void
}

export interface McpContext {
  session: SessionState
  hmrWriter: HmrWriter
  options: ViteLiveDevMcpOptions
  connectedClients: number
  hot?: HotChannel
}

function createMcpServerInstance(ctx: McpContext): McpServer {
  const mcp = new McpServer(
    { name: 'vite-live-dev-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  mcp.tool(
    'get_session_info',
    'Returns log directory, file paths, and server URLs. Call this first to orient.',
    async () => {
      const { info } = ctx.session
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                session_id: info.sessionId,
                log_dir: info.logDir,
                files: info.files,
                channels_active: info.channels,
                server_url: info.serverUrl,
                mcp_url: info.mcpUrl,
                started_at: info.startedAt,
                connected_clients: ctx.connectedClients,
                hint: 'Use grep/tail/cat on the file paths above. Call get_hmr_status to check HMR state.',
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  mcp.tool(
    'get_hmr_status',
    'Returns HMR update/error counts and pending state. Lightweight poll.',
    { since: z.number().optional().describe('Unix ms timestamp, default: session start') },
    async (args) => {
      const status = ctx.hmrWriter.getStatus(args.since)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      }
    },
  )

  mcp.tool(
    'clear_logs',
    'Truncates channel log files. Call before a fix iteration so subsequent reads only show new events.',
    {
      channels: z
        .array(z.string())
        .optional()
        .describe("Channels to clear. Default: all active. Pass ['all'] for all."),
    },
    async (args) => {
      let channelsToClear = args.channels
      if (!channelsToClear || channelsToClear.length === 0 || channelsToClear.includes('all')) {
        channelsToClear = ctx.session.channels
      }

      const countsBefore = truncateChannelFiles(ctx.session.files, channelsToClear)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                cleared_at: Date.now(),
                cleared_at_id: 1,
                files: ctx.session.files,
                counts_cleared: countsBefore,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  if (ctx.options.react) {
    mcp.tool(
      'get_react_tree',
      'On-demand React component tree snapshot via bippy. Returns tree and writes to react.ndjson.',
      {
        depth: z.number().optional().describe('Max tree depth (default: 8, max: 20)'),
        filter_name: z.string().optional().describe('Include only components matching this pattern'),
        include_props: z.boolean().optional().describe('Include component props (default: true)'),
        include_state: z.boolean().optional().describe('Include component state (default: false)'),
      },
      async (args) => {
        if (!ctx.hot) {
          return {
            content: [{ type: 'text' as const, text: 'No hot channel available. Is the dev server running?' }],
            isError: true,
          }
        }

        const requestId = Math.random().toString(36).slice(2)

        // Send request to browser and wait for response
        const result = await new Promise<unknown>((resolve) => {
          const timeout = setTimeout(() => {
            resolve({
              snapshot_at: Date.now(),
              file: ctx.session.files.react ?? '',
              total_components: 0,
              tree: [],
              error: 'Timeout waiting for browser response. Is the browser open?',
            })
          }, 5000)

          ctx.hot!.on('harness:react-tree-response', (data: any) => {
            if (data.requestId === requestId) {
              clearTimeout(timeout)
              resolve(data)
            }
          })

          ctx.hot!.send('harness:get-react-tree', {
            depth: args.depth,
            filter_name: args.filter_name,
            include_props: args.include_props,
            include_state: args.include_state,
            requestId,
          })
        })

        // Write to react.ndjson
        if (ctx.session.files.react) {
          const { appendFileSync } = await import('node:fs')
          const event = {
            id: Date.now(),
            ts: Date.now(),
            channel: 'react',
            payload: result,
          }
          appendFileSync(ctx.session.files.react, JSON.stringify(event) + '\n')
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { ...result as object, file: ctx.session.files.react ?? '' },
                null,
                2,
              ),
            },
          ],
        }
      },
    )
  }

  return mcp
}

// Map of sessionId → { transport, server } for routing POST messages
const connections = new Map<string, { transport: SSEServerTransport; server: McpServer }>()

export function sendNotificationToAll(channel: 'errors' | 'hmr', message: string, file: string, hint: string): void {
  for (const { server } of connections.values()) {
    server.server.sendLoggingMessage({
      level: 'error',
      data: JSON.stringify({ channel, message, file, hint }),
    }).catch(() => {
      // Fire and forget — notification delivery is best-effort
    })
  }
}

export function createMcpMiddleware(
  mcpPath: string,
  ctx: McpContext,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''

    // SSE connection endpoint
    if (url === `${mcpPath}/sse` && req.method === 'GET') {
      const transport = new SSEServerTransport(`${mcpPath}/message`, res)
      const server = createMcpServerInstance(ctx)

      connections.set(transport.sessionId, { transport, server })
      ctx.connectedClients++

      transport.onclose = () => {
        connections.delete(transport.sessionId)
        ctx.connectedClients = Math.max(0, ctx.connectedClients - 1)
      }

      server.connect(transport).catch((err) => {
        console.error('[vite-live-dev-mcp] SSE connection error:', err)
      })
      return
    }

    // Message endpoint
    if (url.startsWith(`${mcpPath}/message`) && req.method === 'POST') {
      const urlObj = new URL(url, 'http://localhost')
      const sessionId = urlObj.searchParams.get('sessionId')

      if (!sessionId || !connections.has(sessionId)) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }))
        return
      }

      const { transport } = connections.get(sessionId)!
      transport.handlePostMessage(req, res).catch((err) => {
        console.error('[vite-live-dev-mcp] Message handling error:', err)
        if (!res.headersSent) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Internal error' }))
        }
      })
      return
    }

    next()
  }
}
