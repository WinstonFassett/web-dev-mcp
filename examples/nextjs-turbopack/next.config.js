import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},  // silence warning about webpack config from withWebDevMcp
}

// Turbopack: also add <WebDevMcpInit /> from '@winstonfassett/web-dev-mcp-nextjs/init' in layout.tsx
export default withWebDevMcp(nextConfig)
