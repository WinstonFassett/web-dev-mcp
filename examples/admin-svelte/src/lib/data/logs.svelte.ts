/**
 * Log subscription manager.
 * Subscribes to gateway events via SSE at /__admin/events.
 * Filtering is done client-side by the LogStream component.
 *
 * NOTE: The admin app has webDevMcp() plugin, so its own console.log messages
 * get captured by the gateway and streamed back. Do NOT console.log inside
 * the event handlers or it creates a feedback loop.
 */

import { getEventsUrl, fetchLogs, notifyConnectionChange } from './gateway'
import { handleRegistryEvent } from './registry.svelte'

export interface LogEntry {
  type: string
  channel: string
  payload: any
  browserId?: string
  serverId?: string
  connId?: string
  timestamp: number
}

const MAX_ENTRIES = 5000

// Reactive state — use mutation (.push/.splice) not reassignment for Svelte 5 reactivity
let _entries: LogEntry[] = $state([])
let _streaming: boolean = $state(false)
let _error: string | null = $state(null)
let _eventSource: EventSource | null = null

export function getLogEntries(): LogEntry[] {
  return _entries
}

export function isStreaming(): boolean {
  return _streaming
}

export function getLogError(): string | null {
  return _error
}

/** Load historical logs from gateway NDJSON files */
async function loadHistory() {
  try {
    const data = await fetchLogs({ limit: 200 })
    const channels = data?.logs ?? {}

    for (const [channel, events] of Object.entries(channels)) {
      if (!Array.isArray(events)) continue
      for (const event of events as any[]) {
        _entries.push({
          type: 'log',
          channel: event.channel ?? channel,
          payload: event.payload,
          browserId: event.payload?.browserId,
          serverId: event.payload?.serverId,
          timestamp: event.ts ?? Date.now(),
        })
      }
    }

    _entries.sort((a, b) => a.timestamp - b.timestamp)
  } catch {
    // History is best-effort
  }
}

/** Start the global log stream via SSE — call once on app init */
export function startLogging() {
  if (_streaming) return
  _streaming = true
  _error = null

  // Load historical logs first
  loadHistory()

  const es = new EventSource(getEventsUrl())
  _eventSource = es

  es.addEventListener('browser_connect', (e) => {
    try {
      const data = JSON.parse(e.data)
      handleRegistryEvent({ type: 'connect', ...data })
    } catch { /* ignore */ }
  })

  es.addEventListener('browser_disconnect', (e) => {
    try {
      const data = JSON.parse(e.data)
      handleRegistryEvent({ type: 'disconnect', ...data })
    } catch { /* ignore */ }
  })

  es.addEventListener('log', (e) => {
    try {
      const data = JSON.parse(e.data)
      const entry: LogEntry = {
        type: 'log',
        channel: data.channel ?? 'unknown',
        payload: data.payload,
        browserId: data.browserId ?? data.payload?.browserId,
        serverId: data.serverId ?? data.payload?.serverId,
        connId: data.connId,
        timestamp: Date.now(),
      }

      if (_entries.length >= MAX_ENTRIES) {
        _entries.splice(0, _entries.length - MAX_ENTRIES + 1)
      }
      _entries.push(entry)
    } catch { /* ignore */ }
  })

  es.onerror = () => {
    _error = 'SSE connection lost'
    _streaming = false
    notifyConnectionChange(false)
    // EventSource auto-reconnects
  }

  es.onopen = () => {
    _streaming = true
    _error = null
    notifyConnectionChange(true)
  }
}

/** Load historical logs for a project from NDJSON files */
export async function loadProjectHistory(serverId: string) {
  try {
    const data = await fetchLogs({ serverId, limit: 200 })
    const channels = data?.logs ?? {}

    const existingTs = new Set(_entries.map(e => e.timestamp))
    for (const [channel, events] of Object.entries(channels)) {
      if (!Array.isArray(events)) continue
      for (const event of events as any[]) {
        if (existingTs.has(event.ts)) continue
        _entries.push({
          type: 'log',
          channel: event.channel ?? channel,
          payload: event.payload,
          browserId: event.payload?.browserId,
          timestamp: event.ts,
        })
      }
    }
    _entries.sort((a, b) => a.timestamp - b.timestamp)
  } catch {
    // History is best-effort
  }
}

/** Stop streaming */
export function stopLogging() {
  if (_eventSource) {
    _eventSource.close()
    _eventSource = null
  }
  _streaming = false
}

/** Clear all entries */
export function clearEntries() {
  _entries.splice(0, _entries.length)
}
