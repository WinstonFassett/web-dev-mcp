/**
 * Browser instrumentation for Next.js apps
 * Loads the gateway's client.js which handles everything:
 * console patching, error handlers, network interception, capnweb RPC
 *
 * Loaded automatically via webpack entry injection from withWebDevMcp(),
 * or manually: import 'web-dev-mcp-gateway/nextjs/instrument'
 */
if (typeof window !== 'undefined' && !(window as any).__WEB_DEV_MCP_LOADED__) {
  const script = document.createElement('script')
  script.src = '/__client.js'
  script.async = true
  document.head.appendChild(script)
}
