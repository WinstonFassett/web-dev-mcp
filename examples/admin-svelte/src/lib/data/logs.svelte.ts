/**
 * Log subscription manager.
 * Subscribes to gateway events via capnweb subscribeEvents().
 * Filtering is done client-side by the LogStream component.
 *
 * NOTE: The admin app has webDevMcp() plugin, so its own console.log messages
 * get captured by the gateway and streamed back. Do NOT console.log inside
 * the stream loop or it creates a feedback loop that floods capnweb.
 */

import { getGateway } from './gateway'
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

export function getLogEntries(): LogEntry[] {
  return _entries
}

export function isStreaming(): boolean {
  return _streaming
}

export function getLogError(): string | null {
  return _error
}

/** Start the global log stream — call once on app init */
export async function startLogging() {
  if (_streaming) return
  _streaming = true
  _error = null

  try {
    const gw = await getGateway()
    const stream: ReadableStream = await gw.stub.subscribeEvents()
    const reader = stream.getReader()

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      const event = value as any

      // Handle connect/disconnect events for registry
      if (event.type === 'connect' || event.type === 'disconnect') {
        handleRegistryEvent(event)
        continue
      }

      // Store all log events unfiltered
      if (event.type === 'log') {
        const entry: LogEntry = {
          type: event.type,
          channel: event.channel ?? 'unknown',
          payload: event.payload,
          browserId: event.browserId ?? event.payload?.browserId,
          serverId: event.serverId ?? event.payload?.serverId,
          connId: event.connId,
          timestamp: Date.now(),
        }

        if (_entries.length >= MAX_ENTRIES) {
          _entries.splice(0, _entries.length - MAX_ENTRIES + 1)
        }
        _entries.push(entry)
      }
    }
  } catch (e: any) {
    if (e?.message !== 'WebSocket closed') {
      _error = e?.message ?? 'Stream error'
    }
  } finally {
    _streaming = false
  }
}

/** Stop streaming — currently only via page unload */
export function stopLogging() {
  // No-op for now; stream ends when WS closes
}

/** Clear all entries */
export function clearEntries() {
  _entries.splice(0, _entries.length)
}
