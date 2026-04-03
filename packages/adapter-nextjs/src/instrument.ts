/**
 * Browser instrumentation for Next.js apps (webpack mode).
 * Loaded automatically via webpack entry injection from withWebDevMcp().
 *
 * For Turbopack, use <WebDevMcpInit /> from '@winstonfassett/web-dev-mcp-nextjs/init' instead.
 */
if (typeof window !== 'undefined' && !(window as any).__WEB_DEV_MCP_INSTRUMENT__) {
  ;(window as any).__WEB_DEV_MCP_INSTRUMENT__ = true
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER) {
    (window as any).__WEB_DEV_MCP_SERVER__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER
  }
  if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY) {
    (window as any).__WEB_DEV_MCP_ORIGIN__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY
  }
  const script = document.createElement('script')
  script.src = '/__web-dev-mcp.js'
  script.async = true
  document.head.appendChild(script)
}
