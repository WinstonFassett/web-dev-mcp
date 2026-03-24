import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

interface McpConfig {
  mcpServers?: Record<string, { url: string }>
  [key: string]: unknown
}

const CONFIG_FILES: Record<string, string> = {
  claude: '.mcp.json',
  cursor: '.cursor/mcp.json',
  windsurf: '.windsurf/mcp.json',
}

export function autoRegister(cwd: string, mcpUrl: string): string[] {
  const registered: string[] = []

  for (const [_agent, relPath] of Object.entries(CONFIG_FILES)) {
    const filePath = join(cwd, relPath)
    const dir = dirname(filePath)

    let config: McpConfig = {}
    if (existsSync(filePath)) {
      try {
        config = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        config = {}
      }
    }

    if (!config.mcpServers) {
      config.mcpServers = {}
    }

    config.mcpServers['web-dev-mcp'] = { url: mcpUrl }

    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
    registered.push(relPath)
  }

  return registered
}
