/**
 * Registry store — projects, servers, browsers.
 * Fetches from /__admin/api and subscribes to live events.
 */

export interface BrowserInfo {
  connId: string
  browserId: string | null
  serverId: string | null
  connectedAt: number
}

export interface ServerInfo {
  id: string
  projectId: string
  directory: string
  type: 'vite' | 'nextjs' | 'storybook' | 'generic'
  port: number
  pid: number
  name?: string
  logDir: string
  registeredAt: number
}

export interface ProjectInfo {
  projectId: string
  name: string
  servers: ServerInfo[]
  browsers: BrowserInfo[]
}

export interface RegistryState {
  projects: ProjectInfo[]
  servers: ServerInfo[]
  browsers: BrowserInfo[]
  uptimeMs: number
  mode: string
  mcpSessions: number
  connected: boolean
}

function getApiUrl(): string {
  if (window.location.hostname === 'localhost' && window.location.port !== '3333') return 'http://localhost:3333/__admin/api'
  return `${window.location.origin}/__admin/api`
}

function groupByProject(servers: ServerInfo[], browsers: BrowserInfo[]): ProjectInfo[] {
  const map = new Map<string, ProjectInfo>()

  for (const s of servers) {
    const pid = s.projectId || s.id
    if (!map.has(pid)) {
      // derive display name from projectId (e.g., "nextjs-app-a3f7" → "nextjs-app-a3f7")
      map.set(pid, { projectId: pid, name: pid, servers: [], browsers: [] })
    }
    map.get(pid)!.servers.push(s)
  }

  for (const b of browsers) {
    // find which project this browser belongs to via serverId
    const server = servers.find(s => s.id === b.serverId)
    const pid = server?.projectId || '__unknown'
    if (!map.has(pid)) {
      map.set(pid, { projectId: pid, name: pid, servers: [], browsers: [] })
    }
    map.get(pid)!.browsers.push(b)
  }

  return Array.from(map.values())
}

// Reactive state — components read these
let _state: RegistryState = $state({
  projects: [],
  servers: [],
  browsers: [],
  uptimeMs: 0,
  mode: 'hub',
  mcpSessions: 0,
  connected: false,
})

export function getRegistry(): RegistryState {
  return _state
}

export async function refreshRegistry(): Promise<void> {
  try {
    const res = await fetch(getApiUrl())
    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()

    _state.servers = data.servers ?? []
    _state.browsers = data.browsers ?? []
    _state.projects = groupByProject(_state.servers, _state.browsers)
    _state.uptimeMs = data.uptime_ms ?? 0
    _state.mode = data.mode ?? 'hub'
    _state.mcpSessions = data.mcp_sessions ?? 0
    _state.connected = true
  } catch {
    _state.connected = false
  }
}

/** Update registry from a live event (browser connect/disconnect) */
export function handleRegistryEvent(event: { type: string; connId?: string; browserId?: string; serverId?: string }) {
  if (event.type === 'connect' && event.connId) {
    const existing = _state.browsers.find(b => b.connId === event.connId)
    if (!existing) {
      _state.browsers = [..._state.browsers, {
        connId: event.connId,
        browserId: event.browserId ?? null,
        serverId: event.serverId ?? null,
        connectedAt: Date.now(),
      }]
      _state.projects = groupByProject(_state.servers, _state.browsers)
    }
  } else if (event.type === 'disconnect' && event.connId) {
    _state.browsers = _state.browsers.filter(b => b.connId !== event.connId)
    _state.projects = groupByProject(_state.servers, _state.browsers)
  }
}
