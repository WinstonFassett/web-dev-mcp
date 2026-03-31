import { readFileSync, existsSync } from 'node:fs'
import type { HarnessEvent, DiagnosticSummary, ConsolePayload, ErrorPayload, NetworkPayload, ServerConsolePayload } from './types.js'
import type { SessionState } from './session.js'
import type { DevEventsWriter } from './writers/dev-events.js'

interface LogQuery {
  channel: string
  sinceId?: number
  limit?: number
  level?: string
  search?: string
  browserId?: string
}

interface LogResult {
  events: HarnessEvent[]
  total: number
  returned: number
  next_cursor: number
}

export function queryLogs(files: Record<string, string>, query: LogQuery): LogResult {
  const filePath = files[query.channel]
  if (!filePath || !existsSync(filePath)) {
    return { events: [], total: 0, returned: 0, next_cursor: 0 }
  }

  const content = readFileSync(filePath, 'utf-8')
  if (!content.trim()) {
    return { events: [], total: 0, returned: 0, next_cursor: 0 }
  }

  const lines = content.trim().split('\n')
  const total = lines.length
  const limit = Math.min(query.limit ?? 20, 200)
  const sinceId = query.sinceId ?? 0

  const events: HarnessEvent[] = []

  for (const line of lines) {
    if (!line.trim()) continue

    let event: HarnessEvent
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (event.id <= sinceId) continue

    if (query.level) {
      const payload = event.payload as Record<string, unknown>
      if (payload.level && payload.level !== query.level) continue
      if (payload.type && payload.type !== query.level) continue
    }

    if (query.browserId) {
      const payload = event.payload as Record<string, unknown>
      if (payload.browserId !== query.browserId) continue
    }

    if (query.search) {
      const serialized = JSON.stringify(event.payload)
      if (!serialized.toLowerCase().includes(query.search.toLowerCase())) continue
    }

    events.push(event)
    if (events.length >= limit) break
  }

  const lastEvent = events[events.length - 1]
  return {
    events,
    total,
    returned: events.length,
    next_cursor: lastEvent ? lastEvent.id : sinceId,
  }
}

/** Count events per channel since a cursor timestamp — no event payloads returned */
export function getSummary(
  files: Record<string, string>,
  channels: string[],
  sinceTs?: number,
): { summary: DiagnosticSummary; event_counts: Record<string, number> } {
  const summary: DiagnosticSummary = {
    error_count: 0,
    warning_count: 0,
    server_error_count: 0,
    failed_requests: 0,
    has_unhandled_rejections: false,
  }
  const event_counts: Record<string, number> = {}

  for (const ch of channels) {
    const filePath = files[ch]
    if (!filePath || !existsSync(filePath)) {
      event_counts[ch] = 0
      continue
    }
    const content = readFileSync(filePath, 'utf-8')
    if (!content.trim()) {
      event_counts[ch] = 0
      continue
    }

    let count = 0
    for (const line of content.trim().split('\n')) {
      if (!line.trim()) continue
      let event: HarnessEvent
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (sinceTs && event.ts <= sinceTs) continue
      count++

      if (ch === 'console') {
        const p = event.payload as ConsolePayload
        if (p.level === 'error') summary.error_count++
        if (p.level === 'warn') summary.warning_count++
      } else if (ch === 'errors') {
        summary.error_count++
        if ((event.payload as ErrorPayload).type === 'unhandled-rejection') {
          summary.has_unhandled_rejections = true
        }
      } else if (ch === 'network') {
        if ((event.payload as NetworkPayload).status >= 400) {
          summary.failed_requests++
        }
      } else if (ch === 'server-console') {
        const p = event.payload as ServerConsolePayload
        if (p.level === 'error') summary.server_error_count++
        if (p.level === 'warn') summary.warning_count++
      }
    }
    event_counts[ch] = count
  }

  return { summary, event_counts }
}

// --- Legacy getDiagnostics kept for mcp-tools-full.ts compatibility ---

interface DiagnosticsQuery {
  since_checkpoint?: boolean
  since_ts?: number
  limit?: number
  level?: string
  search?: string
  browserId?: string
}

export function getDiagnostics(
  files: Record<string, string>,
  session: SessionState,
  query: DiagnosticsQuery,
  devEventsWriter?: DevEventsWriter,
) {
  const since_ts = query.since_checkpoint && session.checkpointTs
    ? session.checkpointTs
    : query.since_ts

  const consoleResult = queryLogs(files, {
    channel: 'console',
    sinceId: since_ts ? findFirstIdAfterTs(files.console, since_ts) : 0,
    limit: query.limit,
    level: query.level,
    search: query.search,
    browserId: query.browserId,
  })

  const errorsResult = queryLogs(files, {
    channel: 'errors',
    sinceId: since_ts ? findFirstIdAfterTs(files.errors, since_ts) : 0,
    limit: query.limit,
    level: query.level,
    search: query.search,
    browserId: query.browserId,
  })

  const networkResult = queryLogs(files, {
    channel: 'network',
    sinceId: since_ts ? findFirstIdAfterTs(files.network, since_ts) : 0,
    limit: query.limit,
    search: query.search,
    browserId: query.browserId,
  })

  const serverConsoleResult = queryLogs(files, {
    channel: 'server-console',
    sinceId: since_ts ? findFirstIdAfterTs(files['server-console'], since_ts) : 0,
    limit: query.limit,
    level: query.level,
    search: query.search,
  })

  const summary: DiagnosticSummary = {
    error_count: 0,
    warning_count: 0,
    server_error_count: 0,
    failed_requests: 0,
    has_unhandled_rejections: false
  }

  for (const event of consoleResult.events) {
    const payload = event.payload as ConsolePayload
    if (payload.level === 'error') summary.error_count++
    if (payload.level === 'warn') summary.warning_count++
  }

  for (const event of errorsResult.events) {
    const payload = event.payload as ErrorPayload
    summary.error_count++
    if (payload.type === 'unhandled-rejection') {
      summary.has_unhandled_rejections = true
    }
  }

  for (const event of networkResult.events) {
    const payload = event.payload as NetworkPayload
    if (payload.status >= 400) {
      summary.failed_requests++
    }
  }

  for (const event of serverConsoleResult.events) {
    const payload = event.payload as ServerConsolePayload
    if (payload.level === 'error') summary.server_error_count++
    if (payload.level === 'warn') summary.warning_count++
  }

  const buildStatus = devEventsWriter
    ? devEventsWriter.getStatus(since_ts)
    : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false }

  return {
    build: buildStatus,
    logs: {
      console: consoleResult.events,
      errors: errorsResult.events,
      network: networkResult.events,
      server_console: serverConsoleResult.events,
    },
    summary,
    checkpoint_ts: session.checkpointTs
  }
}

function findFirstIdAfterTs(filePath: string, ts: number): number {
  if (!filePath || !existsSync(filePath)) return 0

  const content = readFileSync(filePath, 'utf-8')
  if (!content.trim()) return 0

  const lines = content.trim().split('\n')

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event: HarnessEvent = JSON.parse(line)
      if (event.ts > ts) return event.id - 1
    } catch {
      continue
    }
  }

  return 0
}
