// Admin UI for web-dev-mcp gateway
// Serves built Svelte admin at /__admin and JSON API at /__admin/api

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAllBrowsers } from './rpc-server.js'
import { getMcpSessionCount } from './mcp-server.js'
import type { ServerRegistry } from './registry.js'

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

export function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  opts: { startedAt: number; registry: ServerRegistry; port: number },
): boolean {
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
