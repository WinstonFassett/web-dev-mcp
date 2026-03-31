// Core MCP tools: set_project, list_projects, list_browsers, get_diagnostics, clear, eval_js_rpc

import { z } from 'zod'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import type { RegisteredServer } from './registry.js'
import { truncateChannelFiles } from './session.js'
import { getSummary } from './log-reader.js'
import { getBrowserStub, getAllBrowsers } from './rpc-server.js'

// --- Opaque cursor: encodes a timestamp so callers don't depend on internal format ---
function encodeCursor(ts: number): string {
  return Buffer.from(String(ts)).toString('base64url')
}
function decodeCursor(cursor: string): number {
  return Number(Buffer.from(cursor, 'base64url').toString())
}

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
  const ALL_CHANNELS = ['errors', 'console', 'server-console', 'network']

  mcp.tool(
    'get_diagnostics',
    'Lightweight health check: summary counts + build/HMR status + log file paths. Returns no event payloads — read the NDJSON files directly for details (e.g. `tail -20 .web-dev-mcp/errors.ndjson`). Call `clear` first, make changes, then call this with the returned cursor to see only new activity.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
      cursor: z.string().optional().describe('Opaque cursor from a previous get_diagnostics or clear call. Only counts events after this point.'),
      channels: z.array(z.string()).optional().describe(`Channels to include in summary. Default: ${ALL_CHANNELS.join(', ')}`),
    },
    async (args) => {
      try {
        const logPaths = getLogPaths(ctx, args.project)
        const channels = args.channels ?? ALL_CHANNELS
        const sinceTs = args.cursor ? decodeCursor(args.cursor) : ctx.session.checkpointTs ?? undefined

        const { summary, event_counts } = getSummary(logPaths, channels, sinceTs)

        const buildStatus = ctx.devEventsWriter
          ? ctx.devEventsWriter.getStatus(sinceTs)
          : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false }

        const cursor = encodeCursor(Date.now())

        // Build file paths map for channels that have log files
        const files: Record<string, string> = {}
        for (const ch of channels) {
          if (logPaths[ch]) files[ch] = logPaths[ch]
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            cursor,
            build: buildStatus,
            summary,
            event_counts,
            files,
          }, null, 2) }],
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true }
      }
    },
  )

  // --- clear ---
  mcp.tool(
    'clear',
    'Truncate log files and return a cursor. Call before making code changes, then pass the cursor to get_diagnostics to see only new activity.',
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
        const cursor = encodeCursor(ctx.session.checkpointTs)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            cursor,
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
