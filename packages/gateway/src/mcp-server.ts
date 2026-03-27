import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { SessionState } from './session.js'
import { truncateChannelFiles } from './session.js'
import { queryLogs, getDiagnostics } from './log-reader.js'
import { getBrowserStub } from './rpc-server.js'
import type { DevEventsWriter } from './writers/dev-events.js'
import type { ServerRegistry } from './registry.js'

export interface McpContext {
  session: SessionState
  connectedClients: number
  devEventsWriter?: DevEventsWriter
  registry?: ServerRegistry
}

/**
 * Helper: Get log file paths for reading logs.
 * Prefers registered server's log paths (hybrid mode) over gateway's own.
 */
function getLogPaths(ctx: McpContext): Record<string, string> {
  // Check if we have a registered server with log paths (hybrid mode)
  if (ctx.registry) {
    const latestServer = ctx.registry.getLatest()
    if (latestServer?.logPaths) {
      return latestServer.logPaths
    }
  }
  // Fallback to gateway's own log files (proxy mode)
  return ctx.session.files
}

function createMcpServerInstance(ctx: McpContext): McpServer {
  const mcp = new McpServer(
    { name: 'web-dev-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  mcp.tool(
    'get_session_info',
    'Returns log directory, file paths, and server URLs. Call this first to orient.',
    async () => {
      const { info } = ctx.session
      const result: any = {
        session_id: info.sessionId,
        log_dir: info.logDir,
        files: info.files,
        channels_active: info.channels,
        server_url: info.serverUrl,
        mcp_url: info.mcpUrl,
        target_url: info.targetUrl,
        started_at: info.startedAt,
        connected_clients: ctx.connectedClients,
      }

      // Include registered servers if registry is available (hybrid mode)
      if (ctx.registry) {
        const servers = ctx.registry.getAll()
        if (servers.length > 0) {
          result.mode = 'hybrid'
          result.registered_servers = servers
        } else {
          result.mode = 'proxy'
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        }],
      }
    },
  )

  mcp.tool(
    'clear_logs',
    'Truncates channel log files. Call before a fix iteration so subsequent reads only show new events.',
    {
      channels: z.array(z.string()).optional().describe("Channels to clear. Default: all."),
    },
    async (args) => {
      let channelsToClear = args.channels
      if (!channelsToClear || channelsToClear.length === 0 || channelsToClear.includes('all')) {
        channelsToClear = ctx.session.channels
      }

      const countsBefore = truncateChannelFiles(ctx.session.files, channelsToClear)
      ctx.session.checkpointTs = Date.now()

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            cleared_at: ctx.session.checkpointTs,
            checkpoint_ts: ctx.session.checkpointTs,
            files: ctx.session.files,
            counts_cleared: countsBefore,
          }, null, 2),
        }],
      }
    },
  )

  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: logs + build status + summary. Single call replaces multiple get_logs calls.',
    {
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear_logs'),
      since_ts: z.number().optional().describe('Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
    },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      const result = getDiagnostics(logPaths, ctx.session, {
        since_checkpoint: args.since_checkpoint,
        since_ts: args.since_ts,
        limit: args.limit,
        level: args.level,
        search: args.search,
      }, ctx.devEventsWriter)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  mcp.tool(
    'get_build_status',
    'Returns build/HMR update and error counts from connected dev server adapter. Lightweight poll.',
    { since: z.number().optional().describe('Unix ms timestamp, default: session start') },
    async (args) => {
      const status = ctx.devEventsWriter
        ? ctx.devEventsWriter.getStatus(args.since)
        : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      }
    },
  )

  mcp.tool(
    'wait_for_condition',
    'Poll browser condition until true or timeout. Use for async assertions.',
    {
      check: z.string().describe('JS expression (must return truthy)'),
      timeout: z.number().optional().describe('Timeout ms (default: 5000)'),
      interval: z.number().optional().describe('Poll interval ms (default: 100)'),
    },
    async (args) => {
      const timeout = args.timeout ?? 5000
      const interval = args.interval ?? 100
      const startTs = Date.now()

      while (true) {
        const elapsed = Date.now() - startTs
        if (elapsed >= timeout) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ matched: false, duration_ms: elapsed, error: 'Timeout waiting for condition' }, null, 2) }]
          }
        }

        const stub = getBrowserStub()
        if (!stub) {
          await new Promise(r => setTimeout(r, interval))
          continue
        }

        try {
          const result = await stub.eval(args.check)
          if (result) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ matched: true, duration_ms: Date.now() - startTs }, null, 2) }]
            }
          }
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ matched: false, duration_ms: Date.now() - startTs, error: err.message ?? String(err) }, null, 2) }],
            isError: true
          }
        }

        await new Promise(r => setTimeout(r, interval))
      }
    },
  )

  mcp.tool(
    'eval_in_browser',
    'Run JavaScript in the browser and return the result.',
    {
      expression: z.string().describe('JavaScript expression to evaluate.'),
      timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (stub) {
        try {
          const start = Date.now()
          const result = await stub.eval(args.expression)
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ result, duration_ms: Date.now() - start }, null, 2) }],
          }
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }, null, 2) }],
            isError: true,
          }
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected. Open the gateway URL in a browser first.' }, null, 2) }],
        isError: true,
      }
    },
  )

  mcp.tool(
    'eval_capnweb',
    'Run JavaScript server-side with document/window as capnweb remote proxies to the browser DOM. Each property access or method call is an RPC round-trip. CSP-safe, multi-statement, supports await. Use for DOM traversal chains and CSP-blocked sites. For accessing browser globals, framework state, or closures, use eval_in_browser instead.',
    {
      code: z.string().describe('JavaScript code. `document` and `window` are capnweb remote proxies. Supports await — use it to read values (e.g. `await el.textContent`). Last expression or explicit `return` value is returned.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
      try {
        const start = Date.now()
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        const fn = new AsyncFunction('document', 'window', 'localStorage', 'sessionStorage', args.code)
        const result = await fn(
          (stub as any).document,
          (stub as any).window,
          (stub as any).localStorage,
          (stub as any).sessionStorage,
        )
        const serialized = typeof result === 'string' ? result
          : result === undefined ? 'undefined'
          : result === null ? 'null'
          : JSON.stringify(result, null, 2)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ result: serialized, duration_ms: Date.now() - start }, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }],
          isError: true,
        }
      }
    },
  )

  mcp.tool(
    'get_logs',
    'Query log files with filtering and pagination.',
    {
      channel: z.string().describe('Channel to query: console, errors, network, dev-events'),
      since_id: z.number().optional().describe('Return events after this ID.'),
      limit: z.number().optional().describe('Max events to return (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level'),
      search: z.string().optional().describe('Text search (case-insensitive)'),
    },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      const result = queryLogs(logPaths, {
        channel: args.channel,
        sinceId: args.since_id,
        limit: args.limit,
        level: args.level,
        search: args.search,
      })
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  mcp.tool(
    'query_dom',
    'Query DOM elements and return cleaned HTML snapshot.',
    {
      selector: z.string().describe('CSS selector (e.g. "#app", ".header", "body")'),
      max_depth: z.number().optional().describe('Max nesting depth (default: 3)'),
      attributes: z.array(z.string()).optional().describe('Attributes to include'),
      text_length: z.number().optional().describe('Max chars of text content per element (default: 100)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (stub) {
        try {
          const result = await stub.queryDom(args.selector ?? 'body', {
            max_depth: args.max_depth,
            attributes: args.attributes,
            text_length: args.text_length,
          })
          return {
            content: [{ type: 'text' as const, text: (result as any).html ?? JSON.stringify(result, null, 2) }],
          }
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }, null, 2) }],
            isError: true,
          }
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected.' }, null, 2) }],
        isError: true,
      }
    },
  )

  // --- Browser interaction tools ---

  mcp.tool(
    'screenshot',
    'Take a screenshot of the page or a specific element. Returns base64 PNG.',
    {
      selector: z.string().optional().describe('CSS selector to screenshot. Omit for full page.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.screenshot(args.selector)
        if ((result as any).error) return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true }
        return {
          content: [
            { type: 'image' as const, data: (result as any).data.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' },
            { type: 'text' as const, text: JSON.stringify({ width: (result as any).width, height: (result as any).height }, null, 2) },
          ],
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'click',
    'Click an element by CSS selector.',
    { selector: z.string().describe('CSS selector of the element to click') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.click(args.selector)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'fill',
    'Fill an input or textarea with a value. Dispatches input and change events.',
    {
      selector: z.string().describe('CSS selector of the input/textarea'),
      value: z.string().describe('Value to fill'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.fill(args.selector, args.value)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'select_option',
    'Select an option in a <select> element by value or visible text.',
    {
      selector: z.string().describe('CSS selector of the <select> element'),
      value: z.string().describe('Option value or visible text to select'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.selectOption(args.selector, args.value)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'hover',
    'Hover over an element by CSS selector.',
    { selector: z.string().describe('CSS selector of the element to hover') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.hover(args.selector)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'press_key',
    'Press a keyboard key, optionally with modifiers.',
    {
      key: z.string().describe('Key to press (e.g. "Enter", "Escape", "a", "Tab")'),
      modifiers: z.object({
        ctrl: z.boolean().optional(),
        shift: z.boolean().optional(),
        alt: z.boolean().optional(),
        meta: z.boolean().optional(),
      }).optional().describe('Modifier keys to hold'),
      selector: z.string().optional().describe('CSS selector of target element. Default: active element.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.pressKey(args.key, args.modifiers, args.selector)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'navigate',
    'Navigate the browser to a URL.',
    { url: z.string().describe('URL to navigate to') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        await stub.eval(`window.location.href = ${JSON.stringify(args.url)}`)
        return { content: [{ type: 'text' as const, text: JSON.stringify({ navigated: args.url }) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'go_back',
    'Navigate back in browser history.',
    async () => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        await stub.eval('history.back()')
        return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'back' }) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'go_forward',
    'Navigate forward in browser history.',
    async () => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        await stub.eval('history.forward()')
        return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'forward' }) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'scroll',
    'Scroll to an element or to absolute coordinates.',
    {
      selector: z.string().optional().describe('CSS selector to scroll into view.'),
      x: z.number().optional().describe('Horizontal scroll position'),
      y: z.number().optional().describe('Vertical scroll position'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.scroll(args.selector, args.x, args.y)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'get_visible_text',
    'Get the visible text content of an element or the whole page.',
    { selector: z.string().optional().describe('CSS selector. Default: document body.') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await stub.getVisibleText(args.selector)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'get_page_markdown',
    'Convert page DOM to markdown with links, headings, and form elements. Useful for understanding page structure and finding clickable elements.',
    { selector: z.string().optional().describe('CSS selector for root element. Default: document body.') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      try {
        const result = await (stub as any).getPageMarkdown(args.selector)
        if ((result as any).error) return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: true }
        return { content: [{ type: 'text' as const, text: (result as any).markdown }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
      }
    },
  )

  mcp.tool(
    'get_react_tree',
    'React component tree snapshot via bippy. Requires --react flag.',
    {
      depth: z.number().optional().describe('Max tree depth (default: 8, max: 20)'),
      filter_name: z.string().optional().describe('Include only components matching this pattern'),
      include_props: z.boolean().optional().describe('Include component props (default: true)'),
      include_state: z.boolean().optional().describe('Include component state (default: false)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected.' }, null, 2) }],
          isError: true,
        }
      }
      try {
        const result = await (stub as any).getReactTree({
          depth: args.depth,
          filter_name: args.filter_name,
          include_props: args.include_props,
          include_state: args.include_state,
        })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }, null, 2) }],
          isError: true,
        }
      }
    },
  )

  return mcp
}

// Map of sessionId → { transport, server } for routing POST messages
const connections = new Map<string, { transport: SSEServerTransport; server: McpServer }>()

export function sendNotificationToAll(channel: string, message: string, file: string, hint: string): void {
  for (const { server } of connections.values()) {
    server.server.sendLoggingMessage({
      level: 'error',
      data: JSON.stringify({ channel, message, file, hint }),
    }).catch(() => {
      // Fire and forget
    })
  }
}

export function createMcpMiddleware(
  mcpPath: string,
  ctx: McpContext,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''

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
