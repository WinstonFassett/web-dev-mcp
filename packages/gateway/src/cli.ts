#!/usr/bin/env node

import { startGateway } from './gateway.js'
import type { GatewayOptions } from './types.js'

const args = process.argv.slice(2)

function parseArgs(args: string[]): Partial<GatewayOptions> & { help?: boolean } {
  const result: Partial<GatewayOptions> & { help?: boolean } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--target' || arg === '-t') {
      result.target = args[++i]
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i], 10)
    } else if (arg === '--network') {
      result.network = true
    } else if (arg === '--react') {
      result.react = true
    } else if (arg === '--https') {
      result.https = true
    } else if (arg === '--cert') {
      result.cert = args[++i]
    } else if (arg === '--key') {
      result.key = args[++i]
    } else if (arg === '--auto-register') {
      result.autoRegister = true
    } else if (arg === '--help' || arg === '-h') {
      result.help = true
    } else if (!arg.startsWith('-') && !result.target) {
      result.target = arg
    }
  }

  return result
}

const opts = parseArgs(args)

if (opts.help) {
  console.log(`
  web-dev-mcp — Universal web development MCP gateway

  Usage:
    npx web-dev-mcp --target http://localhost:3000
    npx web-dev-mcp -t http://localhost:3000 -p 8080 --network --react

  Options:
    --target, -t <url>   Dev server URL to proxy (required)
    --port, -p <port>    Gateway port (default: 3333)
    --network            Capture fetch/XHR requests
    --react              Enable React DevTools (bippy) integration
    --https              Enable HTTPS with self-signed cert
    --cert <path>        Custom TLS certificate (use with --key)
    --key <path>         Custom TLS private key (use with --cert)
    --auto-register      Register MCP URL in .mcp.json, .cursor/, .windsurf/
    --help, -h           Show this help
`)
  process.exit(0)
}

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
  react: opts.react,
  https: opts.https,
  cert: opts.cert,
  key: opts.key,
  autoRegister: opts.autoRegister,
}).catch((err) => {
  console.error('Failed to start gateway:', err)
  process.exit(1)
})
