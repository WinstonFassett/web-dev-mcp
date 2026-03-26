import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { SessionState } from './session.js'
import { truncateChannelFiles } from './session.js'
import { queryLogs, getDiagnostics } from './log-reader.js'
import type { HmrWriter } from './writers/hmr.js'
import type { ViteLiveDevMcpOptions } from './types.js'
import { getBrowserStub } from './rpc-server.js'

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

function relayToBrowser(
  ctx: McpContext,
  sendEvent: string,
  responseEvent: string,
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<any> {
  if (!ctx.hot) {
    return Promise.resolve({ error: 'No hot channel available. Is the dev server running?' })
  }
  const requestId = Math.random().toString(36).slice(2)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ error: 'Timeout waiting for browser response. Is the browser open?', requestId })
    }, timeoutMs)
    ctx.hot!.on(responseEvent, (data: any) => {
      if (data.requestId === requestId) {
        clearTimeout(timeout)
        resolve(data)
      }
    })
    ctx.hot!.send(sendEvent, { ...payload, requestId })
  })
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

      // Set checkpoint timestamp
      ctx.session.checkpointTs = Date.now()

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                cleared_at: ctx.session.checkpointTs,
                checkpoint_ts: ctx.session.checkpointTs,
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

  // get_diagnostics
  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: logs + HMR + summary. Single call replaces multiple get_logs calls.',
    {
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear_logs'),
      since_ts: z.number().optional().describe('Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
    },
    async (args) => {
      const result = getDiagnostics(
        ctx.session.files,
        ctx.hmrWriter,
        ctx.session,
        {
          since_checkpoint: args.since_checkpoint,
          since_ts: args.since_ts,
          limit: args.limit,
          level: args.level,
          search: args.search,
        }
      )
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    },
  )

  // wait_for_condition
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
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                matched: false,
                duration_ms: elapsed,
                error: 'Timeout waiting for condition'
              }, null, 2)
            }]
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
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  matched: true,
                  duration_ms: Date.now() - startTs
                }, null, 2)
              }]
            }
          }
        } catch (err: any) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                matched: false,
                duration_ms: Date.now() - startTs,
                error: err.message ?? String(err)
              }, null, 2)
            }],
            isError: true
          }
        }

        await new Promise(r => setTimeout(r, interval))
      }
    },
  )

  // eval_in_browser
  mcp.tool(
    'eval_in_browser',
    'Run JavaScript in the browser and return the result. Use for DOM queries, checking state, or any browser-side computation.',
    {
      expression: z.string().describe('JavaScript expression to evaluate. Return value is serialized as JSON.'),
      timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
    },
    async (args) => {
      // Try capnweb RPC first
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

      // Fall back to HMR relay
      const result = await relayToBrowser(
        ctx,
        'harness:eval',
        'harness:eval-response',
        { expression: args.expression },
        args.timeout ?? 5000,
      )
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error, stack: result.stack, duration_ms: result.duration_ms }, null, 2) }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ result: result.result, duration_ms: result.duration_ms }, null, 2) }],
      }
    },
  )

  // get_logs
  mcp.tool(
    'get_logs',
    'Query log files with filtering and pagination. Returns structured events from console, hmr, errors, or network channels.',
    {
      channel: z.string().describe('Channel to query: console, hmr, errors, network'),
      since_id: z.number().optional().describe('Return events after this ID (line number). For pagination.'),
      limit: z.number().optional().describe('Max events to return (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn") or type (e.g. "unhandled-exception")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
    },
    async (args) => {
      const result = queryLogs(ctx.session.files, {
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

  // query_dom
  mcp.tool(
    'query_dom',
    'Query DOM elements and return cleaned HTML with only the tags and attributes you need. Agent controls depth, attributes, and text truncation.',
    {
      selector: z.string().describe('CSS selector to query (e.g. "#app", ".header", "form"). Omit or use "body" for whole page.'),
      max_depth: z.number().optional().describe('Max nesting depth to serialize (default: 3)'),
      attributes: z.array(z.string()).optional().describe('Attributes to include (default: id, class, href, src, value, type, placeholder, role, aria-label)'),
      text_length: z.number().optional().describe('Max chars of text content per element (default: 100)'),
    },
    async (args) => {
      // Try capnweb RPC first
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

      // Fall back to HMR relay
      const result = await relayToBrowser(
        ctx,
        'harness:query-dom',
        'harness:query-dom-response',
        {
          selector: args.selector,
          max_depth: args.max_depth,
          attributes: args.attributes,
          text_length: args.text_length,
        },
      )
      if (result.error) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }, null, 2) }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: result.html }],
      }
    },
  )

  // --- Browser interaction tools ---

  mcp.tool(
    'screenshot',
    'Take a screenshot of the page or a specific element. Returns base64 PNG. Lazy-loads html2canvas on first use.',
    {
      selector: z.string().optional().describe('CSS selector to screenshot. Omit for full page.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
      try {
        const result = await stub.screenshot(args.selector)
        if ((result as any).error) {
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: true }
        }
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
    {
      selector: z.string().describe('CSS selector of the element to click'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
    'Hover over an element by CSS selector. Triggers mouseenter/mouseover events.',
    {
      selector: z.string().describe('CSS selector of the element to hover'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
    'Press a keyboard key, optionally with modifiers. Dispatches keydown/keypress/keyup.',
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
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
    {
      url: z.string().describe('URL to navigate to'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
      selector: z.string().optional().describe('CSS selector to scroll into view. If omitted, scrolls to x/y coordinates.'),
      x: z.number().optional().describe('Horizontal scroll position (used when no selector)'),
      y: z.number().optional().describe('Vertical scroll position (used when no selector)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
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
    {
      selector: z.string().optional().describe('CSS selector. Default: document body.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
      try {
        const result = await stub.getVisibleText(args.selector)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !!(result as any).error }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
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
        const result = await relayToBrowser(
          ctx,
          'harness:get-react-tree',
          'harness:react-tree-response',
          {
            depth: args.depth,
            filter_name: args.filter_name,
            include_props: args.include_props,
            include_state: args.include_state,
          },
        )

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
