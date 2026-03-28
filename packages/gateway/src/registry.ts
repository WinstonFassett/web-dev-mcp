/**
 * Server Registry - tracks dev servers registered with the gateway
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RegisteredServer {
  id: string              // sha256(directory).slice(0,8)
  directory: string       // Absolute project path (required)
  type: 'vite' | 'nextjs' | 'generic'
  port: number
  pid: number
  name?: string           // Optional friendly name
  rpcEndpoint?: string    // ws://localhost:5173/__rpc
  mcpEndpoint?: string    // http://localhost:5173/__mcp/sse (for native MCP)
  logPaths: Record<string, string>  // Channel → file path (always populated)
  logDir: string          // Absolute path to project's .web-dev-mcp/
  registeredAt: number
}

/** Generate a stable server ID from a directory path */
export function serverIdFromDirectory(directory: string): string {
  return createHash('sha256').update(directory).digest('hex').slice(0, 8)
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
  private servers = new Map<string, RegisteredServer>()
  private connectionOrder: string[] = []

  add(server: RegisteredServer): void {
    this.servers.set(server.id, server)

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
      const index = this.connectionOrder.indexOf(id)
      if (index !== -1) {
        this.connectionOrder.splice(index, 1)
      }
      console.log(`[registry] Removed: ${id}`)
    }
  }

  get(id: string): RegisteredServer | undefined {
    return this.servers.get(id)
  }

  getByDirectory(directory: string): RegisteredServer | undefined {
    const id = serverIdFromDirectory(directory)
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
