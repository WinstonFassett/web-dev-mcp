#!/usr/bin/env node

import { startGateway } from './gateway.js'
import type { GatewayOptions } from './types.js'

const args = process.argv.slice(2)

function parseArgs(args: string[]): Partial<GatewayOptions> & { help?: boolean; autoRegister?: boolean; global?: boolean } {
  const result: Partial<GatewayOptions> & { help?: boolean; autoRegister?: boolean; global?: boolean } = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i], 10)
    } else if (arg === '--network') {
      result.network = true
    } else if (arg === '--https') {
      result.https = true
    } else if (arg === '--cert') {
      result.cert = args[++i]
    } else if (arg === '--key') {
      result.key = args[++i]
    } else if (arg === '--auto-register') {
      result.autoRegister = true
    } else if (arg === '--global') {
      result.global = true
    } else if (arg === '--help' || arg === '-h') {
      result.help = true
    }
  }

  return result
}

const opts = parseArgs(args)

if (opts.help) {
  console.log(`
  web-dev-mcp-gateway — MCP gateway for web development

  Usage:
    npx web-dev-mcp-gateway
    npx web-dev-mcp-gateway -p 8080 --network

  Dynamic proxy (browse any URL through the gateway):
    http://localhost:3333/http://localhost:3000/page

  Options:
    --port, -p <port>    Gateway port (default: 3333)
    --network            Capture fetch/XHR requests
    --https              Enable HTTPS with self-signed cert
    --cert <path>        Custom TLS certificate (use with --key)
    --key <path>         Custom TLS private key (use with --cert)
    --auto-register      Register MCP URL in .mcp.json, .cursor/, .windsurf/
    --global             With --auto-register: write to user-level configs (~/.claude/, ~/.cursor/)
    --help, -h           Show this help
`)
  process.exit(0)
}

if (opts.autoRegister) {
  // Register MCP config and exit — don't start the server
  const { autoRegister, autoRegisterGlobal } = await import('./auto-register.js')
  const port = opts.port ?? 3333
  const mcpUrl = `http://localhost:${port}/__mcp/sse`

  if (opts.global) {
    const registered = autoRegisterGlobal(mcpUrl)
    for (const path of registered) {
      console.log(`  Auto-registered (global): ${path}`)
    }
  } else {
    const registered = autoRegister(process.cwd(), mcpUrl)
    for (const path of registered) {
      console.log(`  Auto-registered: ${path}`)
    }
  }
  process.exit(0)
} else {
  startGateway({
    port: opts.port,
    network: opts.network,
    https: opts.https,
    cert: opts.cert,
    key: opts.key,
  }).catch((err) => {
    console.error('Failed to start gateway:', err)
    process.exit(1)
  })
}
