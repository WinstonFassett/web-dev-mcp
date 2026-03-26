import { NdjsonWriter } from './base.js'
import type { ConsolePayload } from '../types.js'

export class ConsoleWriter {
  private writer: NdjsonWriter

  constructor(filePath: string, maxFileSizeMb?: number) {
    this.writer = new NdjsonWriter(filePath, 'console', maxFileSizeMb)
  }

  write(payload: ConsolePayload) {
    return this.writer.write(payload)
  }

  resetId() {
    this.writer.resetId()
  }
}
