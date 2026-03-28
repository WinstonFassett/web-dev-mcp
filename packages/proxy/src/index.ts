// Dynamic proxy middleware for web-dev-mcp-gateway
// Proxies any URL with client.js injection for MCP instrumentation
//
// Usage with gateway:
//   import { createProxyMiddleware } from 'web-dev-mcp-proxy'
//   server.middlewares.use(createProxyMiddleware(clientScript))
//
// Then browse: http://localhost:3333/http://localhost:3000/page

import httpProxy from 'http-proxy'
import { gunzipSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'

export function createProxyMiddleware(clientScript: string) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''
    const match = url.match(/^\/(https?:\/\/.+)/)
    if (!match) return next()

    const targetUrl = new URL(match[1])
    req.url = targetUrl.pathname + targetUrl.search

    const proxy = httpProxy.createProxyServer({
      target: targetUrl.origin,
      changeOrigin: true,
      selfHandleResponse: true,
      secure: false,
    })

    proxy.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end(`Proxy error: ${err.message}\nTarget: ${targetUrl.origin}`)
      }
    })

    proxy.on('proxyRes', (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] ?? ''
      if (!contentType.includes('text/html')) {
        res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
        proxyRes.pipe(res)
        return
      }

      const chunks: Buffer[] = []
      const contentEncoding = proxyRes.headers['content-encoding']
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        let buffer = Buffer.concat(chunks)
        if (contentEncoding === 'gzip') {
          try { buffer = gunzipSync(buffer) } catch {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
            res.end(buffer)
            return
          }
        }
        let html = buffer.toString('utf-8')
        const basePath = '/' + targetUrl.origin + targetUrl.pathname.replace(/\/[^/]*$/, '/')
        const injection = `<base href="${basePath}"><script src="/__client.js"></script>`
        if (html.includes('</head>')) html = html.replace('</head>', injection + '</head>')
        else if (html.includes('<head>')) html = html.replace('<head>', '<head>' + injection)
        else if (html.includes('</body>')) html = html.replace('</body>', injection + '</body>')
        else html += injection

        const headers = { ...proxyRes.headers }
        delete headers['content-length']
        delete headers['content-encoding']
        res.writeHead(proxyRes.statusCode ?? 200, headers)
        res.end(html)
      })
    })

    proxy.web(req, res)
  }
}
