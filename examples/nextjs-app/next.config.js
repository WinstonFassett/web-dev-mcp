import { withWebDevMcp } from 'web-dev-mcp-gateway/nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly disable experimental features
  experimental: {},
  // Use webpack mode (not Turbopack) since we have webpack config
  turbopack: {},
}

export default withWebDevMcp(nextConfig, {
  gatewayUrl: 'http://localhost:3333',
  network: true,
})
