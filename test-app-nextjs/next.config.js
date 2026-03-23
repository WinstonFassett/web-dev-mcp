import { withNextMcp } from 'next-live-dev-mcp'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly disable experimental features
  experimental: {},
}

export default withNextMcp(nextConfig, {
  network: false,
  printUrl: true,
})
