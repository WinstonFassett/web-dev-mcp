import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

interface AgentConfig {
  relPath: string
  /** JSON key that holds the server map — VS Code uses "servers", others use "mcpServers" */
  serversKey: string
}

const AGENTS: Record<string, AgentConfig> = {
  claude:   { relPath: '.mcp.json',           serversKey: 'mcpServers' },
  cursor:   { relPath: '.cursor/mcp.json',    serversKey: 'mcpServers' },
  windsurf: { relPath: '.windsurf/mcp.json',  serversKey: 'mcpServers' },
  vscode:   { relPath: '.vscode/mcp.json',    serversKey: 'servers' },
}

export function autoRegister(cwd: string, mcpUrl: string): string[] {
  const registered: string[] = []

  for (const [_agent, { relPath, serversKey }] of Object.entries(AGENTS)) {
    const filePath = join(cwd, relPath)
    const dir = dirname(filePath)

    let config: Record<string, unknown> = {}
    if (existsSync(filePath)) {
      try {
        config = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        config = {}
      }
    }

    const servers = (config[serversKey] as Record<string, unknown>) ?? {}
    servers['web-dev-mcp'] = { url: mcpUrl }
    config[serversKey] = servers

    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
    registered.push(relPath)
  }

  return registered
}
