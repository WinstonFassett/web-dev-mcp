/**
 * Browser instrumentation for Next.js apps
 * Loads the gateway's client.js which handles everything:
 * console patching, error handlers, network interception, capnweb RPC
 */
if (typeof window !== 'undefined' && !window.__WEB_DEV_MCP_LOADED__) {
  const script = document.createElement('script')
  script.src = '/__client.js'
  script.async = true
  document.head.appendChild(script)
}
