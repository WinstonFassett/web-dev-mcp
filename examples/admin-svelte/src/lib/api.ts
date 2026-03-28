/** Fetch gateway admin API */

export interface BrowserInfo {
  connId: string
  browserId: string | null
  serverId: string | null
  connectedAt: number
}

export interface ServerInfo {
  id: string
  directory: string
  type: 'vite' | 'nextjs' | 'generic'
  port: number
  pid: number
  name?: string
  logDir: string
  registeredAt: number
}

export interface AdminData {
  uptime_ms: number
  mode: string
  browsers: BrowserInfo[]
  servers: ServerInfo[]
  mcp_sessions: number
}

const GATEWAY = 'http://localhost:3333'

export async function fetchAdminData(): Promise<AdminData> {
  const res = await fetch(`${GATEWAY}/__admin/api`)
  if (!res.ok) throw new Error(`Admin API: ${res.status}`)
  return res.json()
}
