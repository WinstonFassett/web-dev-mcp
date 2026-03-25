import { BufferedNdjsonWriter } from './base.js';
export class NetworkWriter {
    writer;
    constructor(filePath, maxFileSizeMb) {
        this.writer = new BufferedNdjsonWriter(filePath, 'network', maxFileSizeMb, 100);
    }
    write(payload) {
        return this.writer.writeBuffered(payload);
    }
    resetId() {
        this.writer.resetId();
    }
    destroy() {
        this.writer.destroy();
    }
}
//# sourceMappingURL=network.js.map