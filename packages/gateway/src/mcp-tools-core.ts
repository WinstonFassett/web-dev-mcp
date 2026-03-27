// Core MCP tools: get_diagnostics, clear, eval_capnweb
// These are the minimal set for coding agents.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics } from './log-reader.js'
import { getBrowserStub } from './rpc-server.js'

export function getLogPaths(ctx: McpContext): Record<string, string> {
  if (ctx.registry) {
    const latestServer = ctx.registry.getLatest()
    if (latestServer?.logPaths) return latestServer.logPaths
  }
  return ctx.session.files
}

export function registerCoreTools(mcp: McpServer, ctx: McpContext) {

  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: logs + build status + summary. Single call replaces multiple get_logs calls.',
    {
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear'),
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
    'clear',
    'Truncate log files and set checkpoint. Call before a code change so get_diagnostics(since_checkpoint) shows only new events.',
    {
      channels: z.array(z.string()).optional().describe('Which log channels to clear. Default: all.'),
    },
    async (args) => {
      let channelsToClear = args.channels
      if (!channelsToClear || channelsToClear.length === 0) {
        channelsToClear = ctx.session.channels
      }
      const countsBefore = truncateChannelFiles(ctx.session.files, channelsToClear)
      ctx.session.checkpointTs = Date.now()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          checkpoint_ts: ctx.session.checkpointTs,
          logs_cleared: countsBefore,
        }, null, 2) }],
      }
    },
  )

  mcp.tool(
    'eval_capnweb',
    'Run JavaScript server-side with document/window as capnweb remote proxies to the browser DOM. Each property access or method call is an RPC round-trip. CSP-safe, multi-statement, supports await. Stateless per call — re-query elements each time. Use `browser.*` helpers for common operations.',
    {
      code: z.string().describe('JavaScript code. Globals: `document`, `window` (capnweb proxies), `browser` (helpers: .markdown(sel?), .screenshot(sel?), .navigate(url), .click(sel), .fill(sel, val), .waitFor(fnOrSel, interval?, timeout?), .eval(expr)). Use `await` to read values.'),
    },
    async (args) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
      try {
        const start = Date.now()
        const doc = (stub as any).document
        const browser = {
          eval: (expression: string) => stub.eval(expression),
          markdown: (selector?: string) => (stub as any).getPageMarkdown(selector),
          screenshot: (selector?: string) => (stub as any).screenshot(selector),
          navigate: (url: string) => (stub as any).navigate(url),
          click: (selector: string) => (stub as any).click(selector),
          fill: (selector: string, value: string) => (stub as any).fill(selector, value),
          waitFor: async (fnOrSelector: string | Function, interval = 100, timeout = 5000) => {
            const deadline = Date.now() + timeout
            while (Date.now() < deadline) {
              try {
                let result
                if (typeof fnOrSelector === 'string') {
                  result = await doc.querySelector(fnOrSelector)
                } else {
                  result = await fnOrSelector()
                }
                if (result) return result
              } catch {}
              await new Promise(r => setTimeout(r, interval))
            }
            throw new Error(`waitFor timed out after ${timeout}ms`)
          },
        }

        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        const fn = new AsyncFunction('document', 'window', 'localStorage', 'sessionStorage', 'browser', args.code)
        const result = await fn(
          (stub as any).document,
          (stub as any).window,
          (stub as any).localStorage,
          (stub as any).sessionStorage,
          browser,
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
}
