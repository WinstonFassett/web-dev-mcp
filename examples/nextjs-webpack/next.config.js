import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'

/** @type {import('next').NextConfig} */
const nextConfig = {}

// Webpack mode: withWebDevMcp injects client via webpack entry + adds rewrites
// No WebDevMcpInit component needed
export default withWebDevMcp(nextConfig)
