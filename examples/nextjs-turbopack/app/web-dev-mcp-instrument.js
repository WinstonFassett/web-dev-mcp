/**
 * Browser instrumentation for Next.js apps
 * Loads the gateway's client.js which handles everything:
 * console patching, error handlers, network interception, capnweb RPC
 *
 * Server ID comes from next.config.env (NEXT_PUBLIC_WEB_DEV_MCP_SERVER)
 */
if (typeof window !== 'undefined' && !window.__WEB_DEV_MCP_LOADED__) {
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER) {
    window.__WEB_DEV_MCP_SERVER__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER
  }
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY) {
    window.__WEB_DEV_MCP_ORIGIN__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY
  }
  const script = document.createElement('script')
  script.src = '/__client.js'
  script.async = true
  document.head.appendChild(script)
}
