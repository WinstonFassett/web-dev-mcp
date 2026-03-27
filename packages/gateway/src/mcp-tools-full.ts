// Full MCP tool set: all legacy tools for MCP-only agents (Cursor, Windsurf, etc.)
// These are registered in addition to core tools when ?tools=full is set.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { getLogPaths } from './mcp-tools-core.js'
import { truncateChannelFiles } from './session.js'
import { queryLogs } from './log-reader.js'
import { getBrowserStub } from './rpc-server.js'

function noBrowser() {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
}

function errResult(err: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
}

export function registerFullTools(mcp: McpServer, ctx: McpContext) {

  mcp.tool(
    'get_session_info',
    'Returns log directory, file paths, and server URLs.',
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
      if (ctx.registry) {
        const servers = ctx.registry.getAll()
        result.mode = servers.length > 0 ? 'hybrid' : 'proxy'
        if (servers.length > 0) result.registered_servers = servers
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  mcp.tool(
    'clear_logs',
    'Truncates channel log files. Call before a fix iteration so subsequent reads only show new events.',
    { channels: z.array(z.string()).optional().describe("Channels to clear. Default: all.") },
    async (args) => {
      let channelsToClear = args.channels
      if (!channelsToClear || channelsToClear.length === 0 || channelsToClear.includes('all')) {
        channelsToClear = ctx.session.channels
      }
      const countsBefore = truncateChannelFiles(ctx.session.files, channelsToClear)
      ctx.session.checkpointTs = Date.now()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          cleared_at: ctx.session.checkpointTs,
          checkpoint_ts: ctx.session.checkpointTs,
          counts_cleared: countsBefore,
        }, null, 2) }],
      }
    },
  )

  mcp.tool(
    'get_build_status',
    'Returns build/HMR update and error counts. Lightweight poll.',
    { since: z.number().optional().describe('Unix ms timestamp, default: session start') },
    async (args) => {
      const status = ctx.devEventsWriter
        ? ctx.devEventsWriter.getStatus(args.since)
        : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false }
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] }
    },
  )

  mcp.tool(
    'wait_for_condition',
    'Poll browser condition until true or timeout.',
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
          return { content: [{ type: 'text' as const, text: JSON.stringify({ matched: false, duration_ms: elapsed, error: 'Timeout' }, null, 2) }] }
        }
        const stub = getBrowserStub()
        if (!stub) { await new Promise(r => setTimeout(r, interval)); continue }
        try {
          const result = await stub.eval(args.check)
          if (result) return { content: [{ type: 'text' as const, text: JSON.stringify({ matched: true, duration_ms: Date.now() - startTs }, null, 2) }] }
        } catch (err: any) {
          return { ...errResult(err), content: [{ type: 'text' as const, text: JSON.stringify({ matched: false, duration_ms: Date.now() - startTs, error: err.message }, null, 2) }] }
        }
        await new Promise(r => setTimeout(r, interval))
      }
    },
  )

  mcp.tool(
    'eval_in_browser',
    'Run JavaScript directly in the browser. Access to all browser globals, framework state, closures. May be blocked by CSP.',
    {
      expression: z.string().describe('JavaScript expression to evaluate.'),
      timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try {
        const start = Date.now()
        const result = await stub.eval(args.expression)
        return { content: [{ type: 'text' as const, text: JSON.stringify({ result, duration_ms: Date.now() - start }, null, 2) }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool(
    'get_logs',
    'Query log files with filtering and pagination.',
    {
      channel: z.string().describe('Channel: console, errors, network, dev-events'),
      since_id: z.number().optional().describe('Return events after this ID.'),
      limit: z.number().optional().describe('Max events (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level'),
      search: z.string().optional().describe('Text search (case-insensitive)'),
    },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      const result = queryLogs(logPaths, { channel: args.channel, sinceId: args.since_id, limit: args.limit, level: args.level, search: args.search })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  mcp.tool(
    'query_dom',
    'Query DOM elements and return cleaned HTML snapshot.',
    {
      selector: z.string().describe('CSS selector'),
      max_depth: z.number().optional().describe('Max nesting depth (default: 3)'),
      attributes: z.array(z.string()).optional().describe('Attributes to include'),
      text_length: z.number().optional().describe('Max text chars per element (default: 100)'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try {
        const result = await stub.queryDom(args.selector ?? 'body', { max_depth: args.max_depth, attributes: args.attributes, text_length: args.text_length })
        return { content: [{ type: 'text' as const, text: (result as any).html ?? JSON.stringify(result, null, 2) }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool(
    'screenshot',
    'Take a screenshot of the page or a specific element. Returns base64 PNG.',
    { selector: z.string().optional().describe('CSS selector. Omit for full page.') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try {
        const result = await stub.screenshot(args.selector)
        if ((result as any).error) return errResult(result)
        return {
          content: [
            { type: 'image' as const, data: (result as any).data.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' },
            { type: 'text' as const, text: JSON.stringify({ width: (result as any).width, height: (result as any).height }, null, 2) },
          ],
        }
      } catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('click', 'Click an element. Supports CSS selector or text= prefix.',
    { selector: z.string().describe('CSS selector or text=...') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.click(args.selector); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('fill', 'Fill an input/textarea. Dispatches input and change events.',
    { selector: z.string().describe('CSS selector or text=...'), value: z.string().describe('Value to fill') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.fill(args.selector, args.value); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('select_option', 'Select an option in a <select> element.',
    { selector: z.string().describe('CSS selector'), value: z.string().describe('Option value or text') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.selectOption(args.selector, args.value); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('hover', 'Hover over an element.',
    { selector: z.string().describe('CSS selector or text=...') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.hover(args.selector); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('press_key', 'Press a keyboard key, optionally with modifiers.',
    {
      key: z.string().describe('Key (e.g. "Enter", "Escape", "a")'),
      modifiers: z.object({ ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional() }).optional(),
      selector: z.string().optional().describe('Target element. Default: active element.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.pressKey(args.key, args.modifiers, args.selector); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('navigate', 'Navigate the browser to a URL. Disconnects RPC — wait before next call.',
    { url: z.string().describe('URL to navigate to') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { await stub.eval(`window.location.href = ${JSON.stringify(args.url)}`); return { content: [{ type: 'text' as const, text: JSON.stringify({ navigated: args.url }) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('go_back', 'Navigate back in browser history.',
    async () => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { await stub.eval('history.back()'); return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'back' }) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('go_forward', 'Navigate forward in browser history.',
    async () => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { await stub.eval('history.forward()'); return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'forward' }) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('scroll', 'Scroll to an element or coordinates.',
    { selector: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.scroll(args.selector, args.x, args.y); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('get_visible_text', 'Get the visible text content of an element or the whole page.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await stub.getVisibleText(args.selector); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('get_page_markdown', 'Convert page DOM to markdown with links, headings, form elements.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try {
        const r = await (stub as any).getPageMarkdown(args.selector)
        if ((r as any).error) return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], isError: true }
        return { content: [{ type: 'text' as const, text: (r as any).markdown }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('get_react_tree', 'React component tree snapshot via bippy. Requires --react flag.',
    {
      depth: z.number().optional().describe('Max tree depth (default: 8)'),
      filter_name: z.string().optional(),
      include_props: z.boolean().optional(),
      include_state: z.boolean().optional(),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) return noBrowser()
      try { const r = await (stub as any).getReactTree(args); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }] } }
      catch (err: any) { return errResult(err) }
    },
  )
}
