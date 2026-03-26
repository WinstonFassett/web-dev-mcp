import { NdjsonWriter } from './base.js'
import type { HmrPayload } from '../types.js'

export class HmrWriter {
  private writer: NdjsonWriter
  private lastUpdateAt: number | null = null
  private lastErrorAt: number | null = null
  private lastError: string | undefined
  private updateCount = 0
  private errorCount = 0
  private pending = false

  constructor(filePath: string, maxFileSizeMb?: number) {
    this.writer = new NdjsonWriter(filePath, 'hmr', maxFileSizeMb)
  }

  write(payload: HmrPayload) {
    const event = this.writer.write(payload)

    if (payload.type === 'error') {
      this.lastErrorAt = event.ts
      this.lastError = payload.error
      this.errorCount++
    } else if (payload.type === 'update') {
      this.lastUpdateAt = event.ts
      this.updateCount++
      this.pending = false
    } else if (payload.type === 'full-reload') {
      this.lastUpdateAt = event.ts
      this.updateCount++
    }

    return event
  }

  setPending(value: boolean) {
    this.pending = value
  }

  getStatus(since?: number) {
    const sinceTs = since ?? 0
    return {
      last_update_at: this.lastUpdateAt,
      last_error_at: this.lastErrorAt,
      last_error: this.lastError,
      update_count: this.lastUpdateAt && this.lastUpdateAt >= sinceTs ? this.updateCount : 0,
      error_count: this.lastErrorAt && this.lastErrorAt >= sinceTs ? this.errorCount : 0,
      pending: this.pending,
    }
  }

  resetId() {
    this.writer.resetId()
  }

  resetCounters() {
    this.updateCount = 0
    this.errorCount = 0
    this.lastUpdateAt = null
    this.lastErrorAt = null
    this.lastError = undefined
    this.pending = false
  }
}
