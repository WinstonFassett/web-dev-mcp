import { NdjsonWriter } from './base.js';
export class ErrorsWriter {
    writer;
    constructor(filePath, maxFileSizeMb) {
        this.writer = new NdjsonWriter(filePath, 'errors', maxFileSizeMb);
    }
    write(payload) {
        return this.writer.write(payload);
    }
    resetId() {
        this.writer.resetId();
    }
}
//# sourceMappingURL=errors.js.map