export { createMcpServer, type NextMcpServerOptions } from './server-setup.js'

export interface NextMcpOptions {
  network?: boolean
  maxFileSizeMb?: number
  printUrl?: boolean
}

/**
 * Wrap Next.js config (for future enhancements)
 *
 * For Wave 1, client code must be manually imported in app/layout.tsx:
 *   import 'next-live-dev-mcp/client'
 *
 * Usage:
 *   const nextConfig = { ... }
 *   export default withNextMcp(nextConfig)
 */
export function withNextMcp(nextConfig: any = {}, options: NextMcpOptions = {}) {
  // For Wave 1: just pass through config
  // Future: could add Turbopack loaders or other enhancements
  return nextConfig
}
