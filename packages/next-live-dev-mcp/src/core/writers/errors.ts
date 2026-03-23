import { NdjsonWriter } from './base.js'
import type { ErrorPayload } from '../types.js'

export class ErrorsWriter {
  private writer: NdjsonWriter

  constructor(filePath: string, maxFileSizeMb?: number) {
    this.writer = new NdjsonWriter(filePath, 'errors', maxFileSizeMb)
  }

  write(payload: ErrorPayload) {
    return this.writer.write(payload)
  }

  resetId() {
    this.writer.resetId()
  }
}
