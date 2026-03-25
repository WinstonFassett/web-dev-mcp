import { NdjsonWriter } from './base.js';
export class ConsoleWriter {
    writer;
    constructor(filePath, maxFileSizeMb) {
        this.writer = new NdjsonWriter(filePath, 'console', maxFileSizeMb);
    }
    write(payload) {
        return this.writer.write(payload);
    }
    resetId() {
        this.writer.resetId();
    }
}
//# sourceMappingURL=console.js.map