import { readFileSync, existsSync } from 'node:fs'
import type { HarnessEvent, DiagnosticsResult, DiagnosticSummary, ConsolePayload, ErrorPayload, NetworkPayload } from './types.js'
import type { HmrWriter } from './writers/hmr.js'
import type { SessionState } from './session.js'

export interface LogQuery {
  channel: string
  sinceId?: number
  limit?: number
  level?: string
  search?: string
}

export interface LogResult {
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
  const limit = Math.min(query.limit ?? 50, 200)
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

    // Cursor filter
    if (event.id <= sinceId) continue

    // Level filter (for console/errors channels)
    if (query.level) {
      const payload = event.payload as Record<string, unknown>
      if (payload.level && payload.level !== query.level) continue
      if (payload.type && payload.type !== query.level) continue
    }

    // Text search
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

export interface DiagnosticsQuery {
  since_checkpoint?: boolean
  since_ts?: number
  limit?: number
  level?: string
  search?: string
}

export function getDiagnostics(
  files: Record<string, string>,
  hmrWriter: HmrWriter,
  session: SessionState,
  query: DiagnosticsQuery
): DiagnosticsResult {
  // Resolve since_ts from checkpoint if requested
  const since_ts = query.since_checkpoint && session.checkpointTs
    ? session.checkpointTs
    : query.since_ts

  // Query all channels
  const consoleResult = queryLogs(files, {
    channel: 'console',
    sinceId: since_ts ? findFirstIdAfterTs(files.console, since_ts) : 0,
    limit: query.limit,
    level: query.level,
    search: query.search
  })

  const errorsResult = queryLogs(files, {
    channel: 'errors',
    sinceId: since_ts ? findFirstIdAfterTs(files.errors, since_ts) : 0,
    limit: query.limit,
    level: query.level,
    search: query.search
  })

  const networkResult = queryLogs(files, {
    channel: 'network',
    sinceId: since_ts ? findFirstIdAfterTs(files.network, since_ts) : 0,
    limit: query.limit,
    search: query.search
  })

  // Compute summary stats
  const summary: DiagnosticSummary = {
    error_count: 0,
    warning_count: 0,
    failed_requests: 0,
    has_unhandled_rejections: false
  }

  // Count console errors and warnings
  for (const event of consoleResult.events) {
    const payload = event.payload as ConsolePayload
    if (payload.level === 'error') summary.error_count++
    if (payload.level === 'warn') summary.warning_count++
  }

  // Count errors channel events and check for unhandled rejections
  for (const event of errorsResult.events) {
    const payload = event.payload as ErrorPayload
    summary.error_count++
    if (payload.type === 'unhandled-rejection') {
      summary.has_unhandled_rejections = true
    }
  }

  // Count failed network requests
  for (const event of networkResult.events) {
    const payload = event.payload as NetworkPayload
    if (payload.status >= 400) {
      summary.failed_requests++
    }
  }

  // Get HMR status
  const hmrStatus = hmrWriter.getStatus(since_ts)

  return {
    hmr: hmrStatus,
    logs: {
      console: consoleResult.events,
      errors: errorsResult.events,
      network: networkResult.events
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
