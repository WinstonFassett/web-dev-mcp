// Core MCP tools: get_diagnostics, clear, eval_js_rpc
// These are the minimal set for coding agents.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics } from './log-reader.js'
import { getBrowserStub } from './rpc-server.js'

// Persistent state per MCP session — holds capnweb proxy refs across eval_js_rpc calls
// Agent stores refs like state.store = window.__REDUX_STORE__ and uses them in later calls
export const sessionStates = new Map<string, Record<string, any>>()

/**
 * Resolve the server for the current MCP context.
 *
 * Resolution chain:
 *   ?project=<dir> → registry lookup by directory → server
 *   no ?project=, 1 server registered → use it (auto-resolve)
 *   no ?project=, 0 servers → undefined (unscoped, gateway-level)
 *   no ?project=, N servers → { ambiguous: true, projects: [...] }
 */
export type ResolvedServer =
  | { server: import('./registry.js').RegisteredServer; ambiguous?: never }
  | { server?: never; ambiguous: true; projects: string[] }

export function resolveServer(ctx: McpContext): ResolvedServer | undefined {
  if (!ctx.registry) return undefined

  if (ctx.projectDir) {
    const server = ctx.registry.getByDirectory(ctx.projectDir)
    if (server) return { server }
    return undefined
  }

  // Auto-resolve: unambiguous if exactly one server
  const size = ctx.registry.size()
  if (size === 0) return undefined
  if (size === 1) return { server: ctx.registry.getAll()[0] }

  // Multiple projects — ambiguous without ?project=
  return { ambiguous: true, projects: ctx.registry.directories() }
}

export function getLogPaths(ctx: McpContext): Record<string, string> {
  const resolved = resolveServer(ctx)
  if (resolved && 'server' in resolved && resolved.server?.logPaths) {
    return resolved.server.logPaths
  }
  return ctx.session.files
}

/** Get the serverId (pid:port) for the current MCP context */
export function getServerId(ctx: McpContext): string | undefined {
  const resolved = resolveServer(ctx)
  if (resolved && 'server' in resolved) return resolved.server?.id
  return undefined
}

/** Format a diagnostic error when server resolution fails */
export function resolutionError(ctx: McpContext): string {
  const resolved = resolveServer(ctx)
  if (resolved && resolved.ambiguous) {
    return `Multiple projects registered. Specify ?project=<directory> on MCP URL.\nRegistered projects:\n${resolved.projects.map(d => `  - ${d}`).join('\n')}`
  }
  if (ctx.projectDir) {
    return `No server registered for project: ${ctx.projectDir}`
  }
  return 'No browser connected'
}

export function registerCoreTools(mcp: McpServer, ctx: McpContext) {

  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: browser logs + server logs + build status + summary. Includes console, errors, network, and server-side console (SSR/API route output).',
    {
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear'),
      since_ts: z.number().optional().describe('Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
      browser_id: z.string().optional().describe('Filter by browser ID'),
    },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      const result = getDiagnostics(logPaths, ctx.session, {
        since_checkpoint: args.since_checkpoint,
        since_ts: args.since_ts,
        limit: args.limit,
        level: args.level,
        search: args.search,
        browserId: args.browser_id,
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
    'eval_js_rpc',
    'Run JavaScript server-side with document/window as capnweb remote proxies to the browser DOM. Each property access or method call is an RPC round-trip. CSP-safe, multi-statement, supports await. Optional `state` object persists across calls — use it to hold refs to JS runtime objects (stores, globals) that survive HMR. Use `browser.*` helpers for common operations.',
    {
      code: z.string().describe('JavaScript code. Globals: `document`, `window` (capnweb proxies), `state` (persists across calls — store refs here), `browser` (helpers: .markdown(sel?), .screenshot(sel?), .navigate(url), .click(sel), .fill(sel, val), .waitFor(fnOrSel, interval?, timeout?), .eval(expr), .elementSource(sel) — returns {componentName, source: {filePath, lineNumber}}). Use `await` to read values.'),
    },
    async (args, extra) => {
      const resolved = resolveServer(ctx)
      if (resolved?.ambiguous) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: resolutionError(ctx) }) }], isError: true }
      }
      const serverId = resolved?.server?.id
      const stub = getBrowserStub(serverId)
      if (!stub) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: resolutionError(ctx) }) }], isError: true }
      }
      try {
        const start = Date.now()
        const sessionId = extra.sessionId ?? '_default'
        if (!sessionStates.has(sessionId)) {
          sessionStates.set(sessionId, {})
        }
        const state = sessionStates.get(sessionId)!
        const doc = (stub as any).document
        const browser = {
          eval: (expression: string) => stub.eval(expression),
          elementSource: async (selector: string) => {
            // Uses findElement which supports text= prefix for text-based matching
            const result = await stub.eval(
              `(function() {` +
              ` var el = document.querySelector && '${selector.replace(/'/g, "\\'")}'.startsWith('text=')` +
              `   ? (function() { var s = '${selector.replace(/'/g, "\\'")}'.slice(5); var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); var n; while (n = w.nextNode()) { if (n.textContent && n.textContent.trim().includes(s) && n.children.length === 0) return n; } return null; })()` +
              `   : document.querySelector('${selector.replace(/'/g, "\\'")}');` +
              ` if (!el) return JSON.stringify({ error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });` +
              ` if (typeof window.__resolveElementInfo !== 'function') return JSON.stringify({ error: 'element-source not installed' });` +
              ` return window.__resolveElementInfo(el).then(function(i) { return JSON.stringify(i); });` +
              `})()`
            )
            try { return JSON.parse(result) } catch { return { error: result } }
          },
          markdown: (selector?: string) => (stub as any).getPageMarkdown(selector),
          screenshot: (selectorOrOpts?: string | Record<string, any>) => (stub as any).screenshot(selectorOrOpts),
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
