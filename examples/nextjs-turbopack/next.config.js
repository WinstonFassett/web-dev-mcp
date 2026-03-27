import { withWebDevMcp } from 'web-dev-mcp-gateway/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},  // silence warning about webpack config from withWebDevMcp
}

// withWebDevMcp adds rewrites for /__mcp, /__rpc, /__events, /__client.js → gateway
// Turbopack: client injection is via WebDevMcpInit component in layout.tsx
export default withWebDevMcp(nextConfig)
