import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionState } from './session.js'
import type { DevEventsWriter } from './writers/dev-events.js'
import type { ServerRegistry } from './registry.js'
import { registerCoreTools, sessionStates } from './mcp-tools-core.js'
import { registerFullTools } from './mcp-tools-full.js'

export interface McpContext {
  session: SessionState
  connectedClients: number
  devEventsWriter?: DevEventsWriter
  registry?: ServerRegistry
  projectDir?: string  // Set from ?project= query param — scopes logs + browser to this project
}

type Toolset = 'core' | 'full'

function createMcpServerInstance(ctx: McpContext, toolset: Toolset = 'core'): McpServer {
  const mcp = new McpServer(
    { name: 'web-dev-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  registerCoreTools(mcp, ctx)

  if (toolset === 'full') {
    registerFullTools(mcp, ctx)
  }

  return mcp
}

// Map of sessionId → { transport, server } for routing POST messages
const connections = new Map<string, { transport: SSEServerTransport; server: McpServer }>()

export function getMcpSessionCount(): number {
  return connections.size
}

export function sendNotificationToAll(channel: string, message: string, file: string, hint: string): void {
  for (const { server } of connections.values()) {
    server.server.sendLoggingMessage({
      level: 'error',
      data: JSON.stringify({ channel, message, file, hint }),
    }).catch(() => {})
  }
}

export function createMcpMiddleware(
  mcpPath: string,
  ctx: McpContext,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''

    if (url.startsWith(`${mcpPath}/sse`) && req.method === 'GET') {
      // Parse toolset from query: /__mcp/sse?tools=full
      const urlObj = new URL(url, 'http://localhost')
      const toolset = (urlObj.searchParams.get('tools') as Toolset) || 'core'
      const projectDir = urlObj.searchParams.get('project') || undefined

      // Create a per-session context with project scoping
      const sessionCtx: McpContext = { ...ctx, projectDir }

      const transport = new SSEServerTransport(`${mcpPath}/message`, res)
      const server = createMcpServerInstance(sessionCtx, toolset)

      connections.set(transport.sessionId, { transport, server })
      ctx.connectedClients++

      transport.onclose = () => {
        connections.delete(transport.sessionId)
        sessionStates.delete(transport.sessionId)
        ctx.connectedClients = Math.max(0, ctx.connectedClients - 1)
      }

      server.connect(transport).catch((err) => {
        console.error('[web-dev-mcp] SSE connection error:', err)
      })
      return
    }

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
        console.error('[web-dev-mcp] Message handling error:', err)
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
