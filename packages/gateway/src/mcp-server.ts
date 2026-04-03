import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionState } from './session.js'
import type { DevEventsWriter } from './writers/dev-events.js'
import type { ServerRegistry } from './registry.js'
import { registerCoreTools } from './mcp-tools-core.js'
import { registerFullTools } from './mcp-tools-full.js'
import { registerElementGrabTool } from './element-grab.js'

export interface McpContext {
  session: SessionState
  connectedClients: number
  devEventsWriter?: DevEventsWriter
  registry?: ServerRegistry
  /** Mutable — set by set_project tool, ?project= param, or roots/list auto-resolve */
  currentProject?: string
}

type Toolset = 'core' | 'full'

function createMcpServerInstance(ctx: McpContext, toolset: Toolset = 'core'): McpServer {
  const mcp = new McpServer(
    { name: 'web-dev-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  registerCoreTools(mcp, ctx)
  registerElementGrabTool(mcp)

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

/**
 * After MCP connect, ask the client for its workspace roots via roots/list.
 * Only auto-sets currentProject if exactly one registered project matches.
 */
async function resolveProjectFromRoots(mcp: McpServer, ctx: McpContext): Promise<void> {
  const registry = ctx.registry
  if (!registry || registry.size() === 0) return

  const result = await mcp.server.listRoots()
  if (!result?.roots?.length) return

  const registeredDirs = registry.directories()
  const matches = new Set<string>()

  for (const root of result.roots) {
    let rootPath: string
    try {
      rootPath = root.uri.startsWith('file://') ? decodeURIComponent(root.uri.slice(7)) : root.uri
    } catch { continue }

    for (const dir of registeredDirs) {
      if (dir.startsWith(rootPath) || rootPath.startsWith(dir)) {
        matches.add(dir)
      }
    }
  }

  // Only auto-set if exactly one match — multiple is ambiguous
  if (matches.size === 1) {
    const dir = matches.values().next().value!
    ctx.currentProject = dir
    console.log(`[web-dev-mcp] Auto-resolved project from roots: ${dir}`)
  } else if (matches.size > 1) {
    console.log(`[web-dev-mcp] Multiple projects match roots (${matches.size}), not auto-resolving`)
  }
}

export function createMcpMiddleware(
  mcpPath: string,
  ctx: McpContext,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''

    if (url.startsWith(`${mcpPath}/sse`) && req.method === 'GET') {
      const urlObj = new URL(url, 'http://localhost')
      const toolset = (urlObj.searchParams.get('tools') as Toolset) || 'core'
      const projectParam = urlObj.searchParams.get('project') || undefined

      // Create a per-session context
      const sessionCtx: McpContext = { ...ctx, currentProject: projectParam }

      const transport = new SSEServerTransport(`${mcpPath}/message`, res)
      const server = createMcpServerInstance(sessionCtx, toolset)

      connections.set(transport.sessionId, { transport, server })
      ctx.connectedClients++

      transport.onclose = () => {
        connections.delete(transport.sessionId)
        ctx.connectedClients = Math.max(0, ctx.connectedClients - 1)
      }

      server.connect(transport).then(() => {
        // After connection, try to auto-resolve project from client roots
        if (!sessionCtx.currentProject && sessionCtx.registry) {
          resolveProjectFromRoots(server, sessionCtx).catch(() => {
            // Client may not support roots/list — that's fine
          })
        }
      }).catch((err) => {
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
