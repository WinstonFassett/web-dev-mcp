import { BufferedNdjsonWriter } from './base.js'
import type { NetworkPayload } from '../types.js'

export class NetworkWriter {
  private writer: BufferedNdjsonWriter

  constructor(filePath: string, maxFileSizeMb?: number) {
    this.writer = new BufferedNdjsonWriter(filePath, 'network', maxFileSizeMb, 100)
  }

  write(payload: NetworkPayload) {
    return this.writer.writeBuffered(payload)
  }

  resetId() {
    this.writer.resetId()
  }

  destroy() {
    this.writer.destroy()
  }
}
