// Core MCP tools: set_project, list_projects, list_browsers, get_diagnostics, clear, eval_js_rpc

import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import type { RegisteredServer } from './registry.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics } from './log-reader.js'
import { getBrowserStub, getAllBrowsers } from './rpc-server.js'

// Persistent state per MCP session — holds capnweb proxy refs across eval_js_rpc calls
// Agent stores refs like state.store = window.__REDUX_STORE__ and uses them in later calls
export const sessionStates = new Map<string, Record<string, any>>()

// --- Project Resolution ---

const GATEWAY_PROJECT = '__gateway'

export interface ResolvedProject {
  type: 'project' | 'gateway'
  server?: RegisteredServer
  logPaths: Record<string, string>
  serverId?: string
}

/**
 * Resolve project from an explicit arg, session currentProject, or auto (single project).
 *
 * Accepts: full directory path, projectId (basename-hash4), or "__gateway".
 * Throws on ambiguity or missing context.
 */
export function resolveProject(ctx: McpContext, projectArg?: string): ResolvedProject {
  const target = projectArg ?? ctx.currentProject
  const registry = ctx.registry

  // __gateway virtual project
  if (target === GATEWAY_PROJECT) {
    return { type: 'gateway', logPaths: ctx.session.files }
  }

  if (target && registry) {
    // Try exact directory match
    let server = registry.getByDirectory(target)
    if (server) return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }

    // Try projectId match (basename-hash4)
    server = registry.getByProjectId(target)
    if (server) return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }

    // Try parent/child match: target is parent of registered dir, or vice versa
    for (const s of registry.getAll()) {
      if (s.directory.startsWith(target + '/') || target.startsWith(s.directory + '/')) {
        return { type: 'project', server: s, logPaths: s.logPaths, serverId: s.id }
      }
    }

    throw new Error(`No project found matching "${target}". Use list_projects to see available projects.`)
  }

  // No explicit target — try auto-resolve
  if (registry) {
    const size = registry.size()
    if (size === 1) {
      const server = registry.getAll()[0]
      return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }
    }
    if (size > 1) {
      const projects = registry.getAll().map(s => `  ${s.projectId} (${s.directory})`).join('\n')
      throw new Error(`Multiple projects registered. Call set_project first:\n${projects}`)
    }
  }

  // No registry or no servers — fall back to gateway
  return { type: 'gateway', logPaths: ctx.session.files }
}

/** Convenience: resolve and get log paths */
export function getLogPaths(ctx: McpContext, projectArg?: string): Record<string, string> {
  return resolveProject(ctx, projectArg).logPaths
}

/** Convenience: resolve and get server ID for browser lookup */
export function getServerId(ctx: McpContext, projectArg?: string): string | undefined {
  return resolveProject(ctx, projectArg).serverId
}

// --- Tool Registration ---

export function registerCoreTools(mcp: McpServer, ctx: McpContext) {

  // --- set_project ---
  mcp.tool(
    'set_project',
    'Set the current project for this session. Required before using browser tools when multiple projects are registered. Accepts: project short ID (from list_projects), full directory path, or "__gateway" for gateway-level operations.',
    {
      project: z.string().describe('Project identifier: short ID (e.g. "nextjs-turbopack-a3f7"), full directory path, or "__gateway"'),
    },
    async (args) => {
      const target = args.project

      if (target === GATEWAY_PROJECT) {
        ctx.currentProject = GATEWAY_PROJECT
        return { content: [{ type: 'text' as const, text: JSON.stringify({ project: GATEWAY_PROJECT, type: 'web-dev-mcp-gateway' }) }] }
      }

      // Validate it resolves before setting
      const resolved = resolveProject(ctx, target)
      if (resolved.type === 'project' && resolved.server) {
        ctx.currentProject = resolved.server.directory
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            project: resolved.server.projectId,
            directory: resolved.server.directory,
            type: resolved.server.type,
            serverId: resolved.server.id,
          }) }],
        }
      }

      // Shouldn't reach here but handle gracefully
      ctx.currentProject = target
      return { content: [{ type: 'text' as const, text: JSON.stringify({ project: target, status: 'set' }) }] }
    },
  )

  // --- list_projects ---
  mcp.tool(
    'list_projects',
    'List all registered dev server projects and the __gateway virtual project.',
    {},
    async () => {
      const projects: any[] = []

      if (ctx.registry) {
        const browsers = getAllBrowsers()
        for (const server of ctx.registry.getAll()) {
          const browserCount = browsers.filter(b => b.serverId === server.id).length
          projects.push({
            id: server.projectId,
            directory: server.directory,
            type: server.type,
            port: server.port,
            serverId: server.id,
            browsers: browserCount,
            current: ctx.currentProject === server.directory,
          })
        }
      }

      projects.push({
        id: GATEWAY_PROJECT,
        type: 'web-dev-mcp-gateway',
        current: ctx.currentProject === GATEWAY_PROJECT,
      })

      return { content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }] }
    },
  )

  // --- list_browsers ---
  mcp.tool(
    'list_browsers',
    'List all connected browsers with their project association.',
    {},
    async () => {
      const browsers = getAllBrowsers()
      const result = browsers.map(b => {
        const server = b.serverId && ctx.registry ? ctx.registry.get(b.serverId) : undefined
        return {
          id: b.browserId,
          connId: b.connId,
          project: server?.projectId ?? null,
          directory: server?.directory ?? null,
          serverId: b.serverId,
          connectedAt: b.connectedAt,
        }
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // --- get_diagnostics ---
  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: browser logs + server logs + build status + summary. TIP: Call `clear` before making changes, then use `since_checkpoint: true` to see only new events. Use `level: "error"` to filter noise.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear'),
      since_ts: z.number().optional().describe('Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 20, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
      browser_id: z.string().optional().describe('Filter by browser ID'),
      max_chars: z.number().optional().describe('Max total characters in response (default: 30000). Truncates oldest events first.'),
    },
    async (args) => {
      try {
        const logPaths = getLogPaths(ctx, args.project)
        const result = getDiagnostics(logPaths, ctx.session, {
          since_checkpoint: args.since_checkpoint,
          since_ts: args.since_ts,
          limit: args.limit,
          level: args.level,
          search: args.search,
          browserId: args.browser_id,
        }, ctx.devEventsWriter)
        const maxChars = args.max_chars ?? 30000
        let text = JSON.stringify(result, null, 2)
        if (text.length > maxChars) {
          // Progressively trim oldest events from least-important channels first
          const channels = ['network', 'console', 'server_console', 'errors'] as const
          for (const ch of channels) {
            const logs = (result as any).logs
            while (logs[ch]?.length > 0 && JSON.stringify(result, null, 2).length > maxChars) {
              logs[ch].shift()
            }
          }
          text = JSON.stringify(result, null, 2)
          if (text.length > maxChars) {
            text = text.slice(0, maxChars) + '\n...(truncated, use since_checkpoint or level filter to narrow results)'
          }
          ;(result as any).truncated = true
        }
        return { content: [{ type: 'text' as const, text }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true }
      }
    },
  )

  // --- clear ---
  mcp.tool(
    'clear',
    'Truncate log files and set checkpoint. Call before a code change so get_diagnostics(since_checkpoint) shows only new events.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
      channels: z.array(z.string()).optional().describe('Which log channels to clear. Default: all.'),
    },
    async (args) => {
      try {
        const logPaths = getLogPaths(ctx, args.project)
        let channelsToClear = args.channels
        if (!channelsToClear || channelsToClear.length === 0) {
          channelsToClear = Object.keys(logPaths)
        }
        const countsBefore = truncateChannelFiles(logPaths, channelsToClear)
        ctx.session.checkpointTs = Date.now()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            checkpoint_ts: ctx.session.checkpointTs,
            logs_cleared: countsBefore,
          }, null, 2) }],
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true }
      }
    },
  )

  // --- eval_js_rpc ---
  mcp.tool(
    'eval_js_rpc',
    'Run JavaScript server-side with document/window as capnweb remote proxies to the browser DOM. Each property access or method call is an RPC round-trip. CSP-safe, multi-statement, supports await. Optional `state` object persists across calls — use it to hold refs to JS runtime objects (stores, globals) that survive HMR. Use `browser.*` helpers for common operations.',
    {
      code: z.string().describe('JavaScript code. Globals: `document`, `window` (capnweb proxies), `state` (persists across calls — store refs here), `browser` (helpers: .markdown(sel?), .screenshot(sel?), .navigate(url), .click(sel), .fill(sel, val), .waitFor(fnOrSel, interval?, timeout?), .eval(expr), .elementSource(sel) — returns {componentName, source: {filePath, lineNumber}}). Use `await` to read values.'),
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
    },
    async (args, extra) => {
      try {
        const resolved = resolveProject(ctx, args.project)
        if (resolved.type === 'gateway') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '__gateway has no browser. Use set_project to target a real project.' }) }], isError: true }
        }
        const stub = getBrowserStub(resolved.serverId)
        if (!stub) {
          const browsers = getAllBrowsers()
          const details = browsers.length > 0
            ? ` (${browsers.length} browser(s) connected with servers: ${browsers.map(b => b.serverId ?? 'untagged').join(', ')})`
            : ' (no browsers connected)'
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `No browser connected for server ${resolved.serverId}${details}` }) }], isError: true }
        }

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

        // Intercept screenshot results — return as MCP image content instead of 76k+ base64 JSON
        if (result && typeof result === 'object' && typeof result.data === 'string' && result.data.startsWith('data:image/')) {
          const match = result.data.match(/^data:image\/(\w+);base64,(.+)$/)
          if (match) {
            const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
            const base64 = match[2]
            const mimeType = `image/${match[1]}` as 'image/png' | 'image/jpeg'
            // Also save to disk for non-MCP consumers
            const screenshotDir = join(ctx.session.logDir, 'screenshots')
            mkdirSync(screenshotDir, { recursive: true })
            const filename = `screenshot-${Date.now()}.${ext}`
            const filePath = join(screenshotDir, filename)
            writeFileSync(filePath, Buffer.from(base64, 'base64'))
            return {
              content: [
                { type: 'image' as const, data: base64, mimeType },
                { type: 'text' as const, text: JSON.stringify({ screenshot: filePath, width: result.width, height: result.height, duration_ms: Date.now() - start }, null, 2) },
              ],
            }
          }
        }

        const serialized = typeof result === 'string' ? result
          : result === undefined ? 'undefined'
          : result === null ? 'null'
          : JSON.stringify(result, null, 2)
        const response: Record<string, any> = { result: serialized, duration_ms: Date.now() - start }
        if (result === undefined && !/\breturn\b/.test(args.code)) {
          response.hint = 'Your code returned undefined. The body runs as an async function — use `return` to send back a value. Example: return await document.title'
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
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
