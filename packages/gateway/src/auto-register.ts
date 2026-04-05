import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

interface AgentConfig {
  relPath: string
  /** JSON key that holds the server map — VS Code uses "servers", others use "mcpServers" */
  serversKey: string
}

/** Project-level config paths (relative to cwd) */
const PROJECT_AGENTS: Record<string, AgentConfig> = {
  claude:   { relPath: '.mcp.json',           serversKey: 'mcpServers' },
  cursor:   { relPath: '.cursor/mcp.json',    serversKey: 'mcpServers' },
  windsurf: { relPath: '.windsurf/mcp.json',  serversKey: 'mcpServers' },
  vscode:   { relPath: '.vscode/mcp.json',    serversKey: 'servers' },
}

/** Global/user-level config paths (relative to home dir) */
const GLOBAL_AGENTS: Record<string, AgentConfig> = {
  claude:   { relPath: '.claude/settings.json', serversKey: 'mcpServers' },
  cursor:   { relPath: '.cursor/mcp.json',      serversKey: 'mcpServers' },
  windsurf: { relPath: '.windsurf/mcp.json',    serversKey: 'mcpServers' },
}

function upsertMcpServer(filePath: string, serversKey: string, mcpUrl: string): boolean {
  const dir = dirname(filePath)

  let config: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      config = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      console.error(`  Skipped ${filePath}: could not parse existing JSON`)
      return false
    }
  }

  const servers = (config[serversKey] as Record<string, unknown>) ?? {}
  servers['web-dev-mcp'] = { url: mcpUrl }
  config[serversKey] = servers

  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
  return true
}

/** Register MCP in project-level config files */
export function autoRegister(cwd: string, mcpUrl: string): string[] {
  const registered: string[] = []

  for (const [_agent, { relPath, serversKey }] of Object.entries(PROJECT_AGENTS)) {
    const filePath = join(cwd, relPath)
    if (upsertMcpServer(filePath, serversKey, mcpUrl)) {
      registered.push(relPath)
    }
  }

  // Ensure .web-dev-mcp is gitignored
  ensureGitignore(cwd, '.web-dev-mcp')

  return registered
}

/** Register MCP in global/user-level config files */
export function autoRegisterGlobal(mcpUrl: string): string[] {
  const home = homedir()
  const registered: string[] = []

  for (const [_agent, { relPath, serversKey }] of Object.entries(GLOBAL_AGENTS)) {
    const filePath = join(home, relPath)
    // Only write to global configs that already exist (don't create dirs for tools the user doesn't have)
    if (!existsSync(dirname(filePath))) continue
    if (upsertMcpServer(filePath, serversKey, mcpUrl)) {
      registered.push(`~/${relPath}`)
    }
  }

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
