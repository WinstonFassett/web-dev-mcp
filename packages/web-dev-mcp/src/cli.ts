#!/usr/bin/env node

import { startGateway } from './gateway.js'

const args = process.argv.slice(2)

function parseArgs(args: string[]): { target?: string; port?: number; network?: boolean } {
  const result: { target?: string; port?: number; network?: boolean } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--target' || arg === '-t') {
      result.target = args[++i]
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i], 10)
    } else if (arg === '--network') {
      result.network = true
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
  web-dev-mcp — Universal web development MCP gateway

  Usage:
    npx web-dev-mcp --target http://localhost:3000
    npx web-dev-mcp -t http://localhost:3000 -p 8080

  Options:
    --target, -t <url>   Dev server URL to proxy (required)
    --port, -p <port>    Gateway port (default: 3333)
    --network            Capture fetch/XHR requests
    --help, -h           Show this help
`)
      process.exit(0)
    } else if (!arg.startsWith('-') && !result.target) {
      // Positional arg as target
      result.target = arg
    }
  }

  return result
}

const opts = parseArgs(args)

if (!opts.target) {
  console.error('Error: --target is required')
  console.error('Usage: npx web-dev-mcp --target http://localhost:3000')
  process.exit(1)
}

// Normalize target URL
let target = opts.target
if (!target.startsWith('http')) {
  target = 'http://' + target
}

startGateway({
  target,
  port: opts.port,
  network: opts.network,
}).catch((err) => {
  console.error('Failed to start gateway:', err)
  process.exit(1)
})
