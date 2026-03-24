import { appendFileSync, statSync, renameSync, writeFileSync } from 'node:fs'
import type { HarnessEvent } from '../types.js'

export class NdjsonWriter {
  private nextId = 1
  private maxFileSize: number

  constructor(
    private filePath: string,
    private channel: string,
    maxFileSizeMb?: number,
  ) {
    this.maxFileSize = (maxFileSizeMb ?? 10) * 1024 * 1024
  }

  write(payload: unknown): HarnessEvent {
    const event: HarnessEvent = {
      id: this.nextId++,
      ts: Date.now(),
      channel: this.channel,
      payload,
    }

    const line = JSON.stringify(event) + '\n'

    try {
      const stats = statSync(this.filePath)
      if (stats.size >= this.maxFileSize) {
        renameSync(this.filePath, this.filePath + '.1')
        writeFileSync(this.filePath, '')
      }
    } catch {
      // File might not exist yet
    }

    appendFileSync(this.filePath, line)
    return event
  }

  resetId(): void {
    this.nextId = 1
  }

  getLastId(): number {
    return this.nextId - 1
  }
}

export class BufferedNdjsonWriter extends NdjsonWriter {
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    filePath: string,
    channel: string,
    maxFileSizeMb?: number,
    private flushIntervalMs = 100,
  ) {
    super(filePath, channel, maxFileSizeMb)
  }

  writeBuffered(payload: unknown): HarnessEvent {
    const event: HarnessEvent = {
      id: 0,
      ts: Date.now(),
      channel: 'network',
      payload,
    }

    this.buffer.push(JSON.stringify({ ...event, id: 0 }))

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
    }

    return event
  }

  flush(): void {
    if (this.buffer.length === 0) return

    for (const _line of this.buffer) {
      const parsed = JSON.parse(_line)
      this.write(parsed.payload)
    }

    this.buffer = []
    this.timer = null
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.flush()
    }
  }
}
