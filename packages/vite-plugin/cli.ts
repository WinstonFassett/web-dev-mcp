#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { createServer, loadConfigFromFile, mergeConfig, type InlineConfig } from 'vite'
import { viteLiveDevMcp } from './plugin.js'
import type { ViteLiveDevMcpOptions } from './types.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    // vite flags
    port: { type: 'string', short: 'p' },
    host: { type: 'string' },
    open: { type: 'boolean' },
    config: { type: 'string', short: 'c' },
    mode: { type: 'string', short: 'm' },
    // plugin flags
    network: { type: 'boolean' },
    react: { type: 'boolean' },
    'no-auto-register': { type: 'boolean' },
    // help
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help) {
  console.log(`
  vite-live-dev-mcp — Vite dev server with live AI observability

  Usage: vite-live-dev-mcp [root] [options]

  Options:
    -p, --port <port>       Port (default: 5173)
    --host [host]           Expose to network
    --open                  Open browser on start
    -c, --config <file>     Vite config file
    -m, --mode <mode>       Vite mode
    --network               Capture fetch/XHR requests
    --react                 Enable React tree inspection
    --no-auto-register      Skip writing MCP configs to .claude/ etc.
    -h, --help              Show this help
`)
  process.exit(0)
}

const root = positionals[0] || undefined

const pluginOpts: ViteLiveDevMcpOptions = {
  network: values.network === true || undefined,
  react: values.react === true || undefined,
  autoRegister: values['no-auto-register'] ? false : undefined,
}

// Build vite inline config from CLI flags
const inlineConfig: InlineConfig = {
  root,
  mode: values.mode as string | undefined,
  server: {
    port: values.port ? Number(values.port) : undefined,
    host: values.host as string | undefined ?? (values.host === '' ? true : undefined),
    open: values.open === true || undefined,
  },
}

async function start() {
  // Load user's vite config if it exists
  const configFile = values.config as string | undefined
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: values.mode as string ?? 'development' },
    configFile,
    root,
  )

  let config: InlineConfig = inlineConfig

  if (loaded) {
    // Check if plugin already present
    const existingPlugins = (Array.isArray(loaded.config.plugins) ? loaded.config.plugins : []).flat()
    const alreadyHasPlugin = existingPlugins.some(
      (p: any) => p && typeof p === 'object' && p.name === 'vite-live-dev-mcp'
    )

    if (!alreadyHasPlugin) {
      loaded.config.plugins = [...(loaded.config.plugins ?? []), viteLiveDevMcp(pluginOpts)]
    }

    config = mergeConfig(loaded.config, inlineConfig)
  } else {
    // No vite config found — set up minimal config with plugin
    config.plugins = [viteLiveDevMcp(pluginOpts)]
  }

  const server = await createServer(config)
  await server.listen()
  server.printUrls()
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
