/**
 * Gateway API helpers — REST + SSE (replaces capnweb RPC).
 * The gateway serves /__admin/api, /__admin/events (SSE),
 * /__admin/eval (POST), and /__admin/logs (GET).
 */

function getBaseUrl(): string {
  const loc = window.location
  if (loc.hostname === 'localhost' && loc.port !== '3333') return 'http://localhost:3333'
  return loc.origin
}

export function getEventsUrl(): string {
  return `${getBaseUrl()}/__admin/events`
}

export async function fetchRegistry() {
  const res = await fetch(`${getBaseUrl()}/__admin/api`)
  if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`)
  return res.json()
}

export async function evalInBrowser(code: string, serverId?: string) {
  const res = await fetch(`${getBaseUrl()}/__admin/eval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, serverId }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error ?? `Eval failed: ${res.status}`)
  return data.result
}

export async function fetchLogs(opts?: {
  serverId?: string
  limit?: number
}) {
  const params = new URLSearchParams()
  if (opts?.serverId) params.set('server_id', opts.serverId)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const res = await fetch(`${getBaseUrl()}/__admin/logs?${params}`)
  if (!res.ok) throw new Error(`Logs fetch failed: ${res.status}`)
  return res.json()
}

// Connection change listeners
type ConnectionListener = (connected: boolean) => void
const listeners: Set<ConnectionListener> = new Set()

export function onConnectionChange(fn: ConnectionListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notifyConnectionChange(connected: boolean) {
  for (const fn of listeners) fn(connected)
}
