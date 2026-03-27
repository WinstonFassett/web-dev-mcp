// Core MCP tools: get_diagnostics, clear, eval_capnweb
// These are the minimal set for coding agents.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics } from './log-reader.js'
import { getBrowserStub } from './rpc-server.js'

// Persistent state per MCP session for eval_capnweb — survives across tool calls
export const capnwebStates = new Map<string, Record<string, any>>()

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
    'Reset logs and/or capnweb session state. Call before a code change for clean diagnostic reads.',
    {
      logs: z.boolean().optional().describe('Clear log files and set checkpoint (default: true)'),
      state: z.boolean().optional().describe('Clear capnweb persistent state/refs (default: false)'),
      channels: z.array(z.string()).optional().describe('Which log channels to clear. Default: all.'),
    },
    async (args, extra) => {
      const clearLogs = args.logs !== false
      const clearState = args.state === true
      const result: any = {}

      if (clearLogs) {
        let channelsToClear = args.channels
        if (!channelsToClear || channelsToClear.length === 0) {
          channelsToClear = ctx.session.channels
        }
        const countsBefore = truncateChannelFiles(ctx.session.files, channelsToClear)
        ctx.session.checkpointTs = Date.now()
        result.logs_cleared = countsBefore
        result.checkpoint_ts = ctx.session.checkpointTs
      }

      if (clearState) {
        const sessionId = extra.sessionId ?? '_default'
        capnwebStates.delete(sessionId)
        result.state_cleared = true
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  mcp.tool(
    'eval_capnweb',
    'Run JavaScript server-side with document/window as capnweb remote proxies to the browser DOM. Each property access or method call is an RPC round-trip. CSP-safe, multi-statement, supports await. A persistent `state` object survives across calls — store references in it. Use `browser.*` helpers for common operations.',
    {
      code: z.string().describe('JavaScript code. Globals: `document`, `window` (capnweb proxies), `state` (persistent), `browser` (helpers: .markdown(sel?), .screenshot(sel?), .navigate(url), .click(sel), .fill(sel, val), .waitFor(fnOrSel, interval?, timeout?), .eval(expr)). Use `await` to read values.'),
    },
    async (args, extra) => {
      const stub = getBrowserStub()
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No browser connected' }) }], isError: true }
      }
      try {
        const start = Date.now()
        const sessionId = extra.sessionId ?? '_default'
        if (!capnwebStates.has(sessionId)) {
          capnwebStates.set(sessionId, {})
        }
        const state = capnwebStates.get(sessionId)!

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
        const fn = new AsyncFunction('document', 'window', 'localStorage', 'sessionStorage', 'state', 'browser', args.code)
        const result = await fn(
          (stub as any).document,
          (stub as any).window,
          (stub as any).localStorage,
          (stub as any).sessionStorage,
          state,
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
