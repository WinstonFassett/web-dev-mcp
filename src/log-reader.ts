import { readFileSync, existsSync } from 'node:fs'
import type { HarnessEvent } from './types.js'

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
