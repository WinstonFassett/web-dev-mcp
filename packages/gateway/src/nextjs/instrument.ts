/**
 * Browser instrumentation for Next.js apps
 * Loads the gateway's client.js which handles everything:
 * console patching, error handlers, network interception, capnweb RPC
 *
 * Loaded automatically via webpack entry injection from withWebDevMcp(),
 * or manually: import 'web-dev-mcp-gateway/nextjs/instrument'
 *
 * Server ID + gateway URL come from next.config.env (works with webpack + Turbopack)
 */
if (typeof window !== 'undefined' && !(window as any).__WEB_DEV_MCP_LOADED__) {
  // next.config.env inlines these via static replacement (NEXT_PUBLIC_ prefix required)
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER) {
    (window as any).__WEB_DEV_MCP_SERVER__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER
  }
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY) {
    (window as any).__WEB_DEV_MCP_ORIGIN__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY
  }
  const script = document.createElement('script')
  script.src = '/__client.js'
  script.async = true
  document.head.appendChild(script)
}
