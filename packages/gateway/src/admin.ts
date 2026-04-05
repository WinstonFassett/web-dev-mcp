// Admin UI for web-dev-mcp gateway
// Serves built admin at /__admin and JSON API at /__admin/api

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAllBrowsers, browserCommand } from './rpc-server.js'
import { getMcpSessionCount } from './mcp-server.js'
import { getDiagnostics } from './log-reader.js'
import type { ServerRegistry } from './registry.js'
import type { SessionState } from './session.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_DIR = join(__dirname, 'admin')

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Cache static files in memory (small admin bundle)
const fileCache = new Map<string, { content: Buffer; mime: string }>()

function serveStatic(res: ServerResponse, filePath: string): boolean {
  let cached = fileCache.get(filePath)
  if (!cached) {
    if (!existsSync(filePath)) return false
    const content = readFileSync(filePath)
    const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
    cached = { content, mime }
    fileCache.set(filePath, cached)
  }
  res.writeHead(200, {
    'Content-Type': cached.mime,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(cached.content)
  return true
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

export function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  opts: { startedAt: number; registry: ServerRegistry; port: number; session: SessionState },
): boolean {
  // CORS preflight
  if (req.method === 'OPTIONS' && url.startsWith('/__admin/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return true
  }

  // POST /__admin/eval — execute JS in a browser
  if (url === '/__admin/eval' && req.method === 'POST') {
    readBody(req).then(async (body) => {
      try {
        const { code, serverId } = JSON.parse(body)
        if (!code) {
          jsonResponse(res, 400, { error: 'Missing "code" field' })
          return
        }
        const result = await browserCommand(serverId, 'eval', { code })
        jsonResponse(res, 200, { result })
      } catch (err: any) {
        jsonResponse(res, 500, { error: err.message ?? String(err) })
      }
    })
    return true
  }

  // GET /__admin/logs — query diagnostics for a project
  if (url.startsWith('/__admin/logs') && req.method === 'GET') {
    const params = new URL(url, 'http://localhost').searchParams
    const serverId = params.get('server_id') || undefined
    const limit = parseInt(params.get('limit') || '200', 10)
    const level = params.get('level') || undefined
    const search = params.get('search') || undefined
    const browserId = params.get('browser_id') || undefined

    let logPaths: Record<string, string>
    if (serverId) {
      const server = opts.registry.get(serverId)
      logPaths = server?.logPaths ?? opts.session.files
    } else {
      logPaths = opts.session.files
    }

    const result = getDiagnostics(logPaths, opts.session, { limit, level, search, browserId })
    jsonResponse(res, 200, result)
    return true
  }

  // JSON API
  if (url === '/__admin/api') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      uptime_ms: Date.now() - opts.startedAt,
      mode: opts.registry.size() > 0 ? 'hybrid' : 'hub',
      browsers: getAllBrowsers(),
      servers: opts.registry.getAll(),
      mcp_sessions: getMcpSessionCount(),
    }))
    return true
  }

  // Serve built admin UI
  if (url === '/__admin' || url === '/__admin/') {
    const indexPath = join(ADMIN_DIR, 'index.html')
    if (serveStatic(res, indexPath)) return true
    // Fallback: admin not built yet
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body style="font-family:system-ui;background:#0a0a0a;color:#888;padding:2rem"><h1>Admin not built</h1><p>Run <code>npm run build</code> in examples/admin-svelte/ first.</p></body></html>')
    return true
  }

  // Serve admin assets (/__admin/assets/*, etc.)
  if (url.startsWith('/__admin/')) {
    const assetPath = url.slice('/__admin/'.length)
    const filePath = join(ADMIN_DIR, assetPath)
    if (serveStatic(res, filePath)) return true
    // Not found — don't handle (let it fall through)
    return false
  }

  return false
}
