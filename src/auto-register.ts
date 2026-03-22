import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ViteLiveDevMcpOptions } from './types.js'

interface McpConfig {
  mcpServers?: Record<string, { url: string }>
  [key: string]: unknown
}

const CONFIG_FILES: Record<string, string> = {
  claude: '.claude/mcp.json',
  cursor: '.cursor/mcp.json',
  windsurf: '.windsurf/mcp.json',
}

export function autoRegister(
  projectRoot: string,
  mcpUrl: string,
  options: ViteLiveDevMcpOptions,
): string[] {
  const autoReg = options.autoRegister
  if (autoReg === false) return []

  const registered: string[] = []

  for (const [agent, relPath] of Object.entries(CONFIG_FILES)) {
    // Check if this agent is enabled
    if (typeof autoReg === 'object' && autoReg[agent as keyof typeof autoReg] === false) {
      continue
    }

    const filePath = join(projectRoot, relPath)
    const dir = dirname(filePath)

    let config: McpConfig = {}
    if (existsSync(filePath)) {
      try {
        config = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        // Malformed JSON — overwrite
        config = {}
      }
    }

    if (!config.mcpServers) {
      config.mcpServers = {}
    }

    config.mcpServers['vite-live-dev-mcp'] = { url: mcpUrl }

    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
    registered.push(relPath)
  }

  return registered
}
