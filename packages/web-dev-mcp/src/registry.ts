/**
 * Server Registry - tracks dev servers registered with the gateway
 */

export interface RegisteredServer {
  id: string              // "vite-5173" or "nextjs-3000"
  type: 'vite' | 'nextjs' | 'generic'
  port: number
  pid: number
  name?: string           // Optional friendly name
  rpcEndpoint?: string    // ws://localhost:5173/__rpc
  mcpEndpoint?: string    // http://localhost:5173/__mcp/sse (for native MCP)
  logPaths?: Record<string, string>  // Channel → file path
  registeredAt: number
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

    console.log(`[registry] Registered: ${server.id} (${server.type}) at :${server.port}`)
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
   * Remove servers whose processes are no longer running
   */
  cleanupDeadServers(): number {
    let removed = 0
    for (const server of this.getAll()) {
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
