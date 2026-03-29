/**
 * Server Registry - tracks dev servers registered with the gateway
 *
 * Identity model:
 *   Project = directory path (persistent scope)
 *   Server  = PID string (ephemeral instance, belongs to a project)
 *   Browser = random uid (belongs to a server instance)
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

/** Stable project short ID: basename-hash4 (e.g. "nextjs-turbopack-a3f7") */
export function makeProjectId(directory: string): string {
  const name = basename(directory)
  const hash = createHash('sha256').update(directory).digest('hex').slice(0, 4)
  return `${name}-${hash}`
}

export interface RegisteredServer {
  id: string              // PID string — ephemeral instance identity
  projectId: string       // Stable short ID: basename-hash4
  directory: string       // Absolute project path (persistent scope)
  type: 'vite' | 'nextjs' | 'storybook' | 'generic'
  port: number
  pid: number
  name?: string           // Optional friendly name
  rpcEndpoint?: string    // ws://localhost:5173/__rpc
  mcpEndpoint?: string    // http://localhost:5173/__mcp/sse (for native MCP)
  logPaths: Record<string, string>  // Channel → file path (always populated)
  logDir: string          // Absolute path to project's .web-dev-mcp/
  registeredAt: number
}

/** Server instance ID = PID (always available, always correct) */
export function makeServerId(pid: number): string {
  return String(pid)
}

/** Create per-project log directory and return channel file paths */
export function initProjectLogDir(
  directory: string,
  channels: string[] = ['console', 'errors', 'dev-events', 'server-console'],
): { logDir: string; logPaths: Record<string, string> } {
  const logDir = join(directory, '.web-dev-mcp')
  mkdirSync(logDir, { recursive: true })

  const logPaths: Record<string, string> = {}
  for (const ch of channels) {
    const filePath = join(logDir, `${ch}.ndjson`)
    logPaths[ch] = filePath
    // Truncate on registration (fresh session)
    writeFileSync(filePath, '')
  }

  return { logDir, logPaths }
}

export class ServerRegistry {
  private servers = new Map<string, RegisteredServer>()       // server ID → server
  private directoryIndex = new Map<string, string>()          // directory → server ID
  private projectIdIndex = new Map<string, string>()          // projectId → server ID
  private connectionOrder: string[] = []

  add(server: RegisteredServer): void {
    // If this project directory already has a server, remove the old one (re-registration)
    const existingId = this.directoryIndex.get(server.directory)
    if (existingId && existingId !== server.id) {
      this.remove(existingId)
    }

    this.servers.set(server.id, server)
    this.directoryIndex.set(server.directory, server.id)
    this.projectIdIndex.set(server.projectId, server.id)

    // Track connection order
    const index = this.connectionOrder.indexOf(server.id)
    if (index !== -1) {
      this.connectionOrder.splice(index, 1)
    }
    this.connectionOrder.push(server.id)

    console.log(`[registry] Registered: ${server.id} (${server.type}) dir=${server.directory}`)
  }

  remove(id: string): void {
    const server = this.servers.get(id)
    if (server) {
      this.servers.delete(id)
      // Clean up directory index if it still points to this server
      if (this.directoryIndex.get(server.directory) === id) {
        this.directoryIndex.delete(server.directory)
      }
      if (this.projectIdIndex.get(server.projectId) === id) {
        this.projectIdIndex.delete(server.projectId)
      }
      const index = this.connectionOrder.indexOf(id)
      if (index !== -1) {
        this.connectionOrder.splice(index, 1)
      }
      console.log(`[registry] Removed: ${id} (dir=${server.directory})`)
    }
  }

  get(id: string): RegisteredServer | undefined {
    return this.servers.get(id)
  }

  getByDirectory(directory: string): RegisteredServer | undefined {
    const id = this.directoryIndex.get(directory)
    if (!id) return undefined
    return this.servers.get(id)
  }

  getByProjectId(projectId: string): RegisteredServer | undefined {
    const id = this.projectIdIndex.get(projectId)
    if (!id) return undefined
    return this.servers.get(id)
  }

  getAll(): RegisteredServer[] {
    return Array.from(this.servers.values())
  }

  getByType(type: RegisteredServer['type']): RegisteredServer[] {
    return this.getAll().filter(s => s.type === type)
  }

  getByPort(port: number): RegisteredServer | undefined {
    return this.getAll().find(s => s.port === port)
  }

  getLatest(): RegisteredServer | undefined {
    if (this.connectionOrder.length === 0) return undefined
    const latestId = this.connectionOrder[this.connectionOrder.length - 1]
    return this.servers.get(latestId)
  }

  has(id: string): boolean {
    return this.servers.has(id)
  }

  size(): number {
    return this.servers.size
  }

  /** List all registered project directories */
  directories(): string[] {
    return Array.from(this.directoryIndex.keys())
  }

  /**
   * Remove servers whose processes are no longer running.
   * Skips servers registered within the last 30s (grace period for process forks).
   */
  cleanupDeadServers(): number {
    let removed = 0
    const now = Date.now()
    for (const server of this.getAll()) {
      // Grace period: don't kill recently registered servers (process may be forking)
      if (now - server.registeredAt < 30_000) continue
      try {
        // Check if process is still alive (signal 0 doesn't actually send a signal)
        process.kill(server.pid, 0)
      } catch (err) {
        // Process doesn't exist
        this.remove(server.id)
        removed++
      }
    }
    return removed
  }
}
