/**
 * Storybook preview decorator — fallback client.js injection
 *
 * Safety net for Storybook configurations that bypass Vite's HTML pipeline.
 */

if (typeof window !== 'undefined' && !(window as any).__WEB_DEV_MCP_LOADED__) {
  const script = document.createElement('script')
  script.src = '/__web-dev-mcp.js'
  script.async = true
  document.head.appendChild(script)
}
