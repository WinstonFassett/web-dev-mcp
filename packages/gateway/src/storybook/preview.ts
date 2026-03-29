/**
 * Storybook preview decorator — fallback client.js injection
 *
 * If transformIndexHtml fires for /iframe.html, client.js is already loaded
 * and __WEB_DEV_MCP_LOADED__ is set. This decorator is a safety net for
 * Storybook configurations that bypass Vite's HTML pipeline.
 */

if (typeof window !== 'undefined' && !(window as any).__WEB_DEV_MCP_LOADED__) {
  const script = document.createElement('script')
  script.src = '/__client.js'
  script.async = true
  document.head.appendChild(script)
}
