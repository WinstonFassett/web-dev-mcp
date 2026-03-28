import { NdjsonWriter } from './base.js'
import type { ServerConsolePayload } from '../types.js'

export class ServerConsoleWriter {
  private writer: NdjsonWriter

  constructor(filePath: string, maxFileSizeMb?: number) {
    this.writer = new NdjsonWriter(filePath, 'server-console', maxFileSizeMb)
  }

  write(payload: ServerConsolePayload) {
    return this.writer.write(payload)
  }

  resetId() {
    this.writer.resetId()
  }
}
