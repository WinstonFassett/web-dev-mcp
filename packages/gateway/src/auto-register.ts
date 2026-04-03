import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
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

  // Ensure .web-dev-mcp is gitignored
  ensureGitignore(cwd, '.web-dev-mcp')

  return registered
}

/** Add an entry to .gitignore if not already present */
function ensureGitignore(cwd: string, entry: string) {
  const gitignorePath = join(cwd, '.gitignore')
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8')
    if (content.split('\n').some(line => line.trim() === entry)) return
    const needsNewline = content.length > 0 && !content.endsWith('\n')
    appendFileSync(gitignorePath, (needsNewline ? '\n' : '') + entry + '\n')
  } else {
    writeFileSync(gitignorePath, entry + '\n')
  }
}
