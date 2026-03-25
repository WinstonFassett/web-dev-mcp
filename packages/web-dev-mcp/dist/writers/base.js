import { appendFileSync, statSync, renameSync, writeFileSync } from 'node:fs';
export class NdjsonWriter {
    filePath;
    channel;
    nextId = 1;
    maxFileSize;
    constructor(filePath, channel, maxFileSizeMb) {
        this.filePath = filePath;
        this.channel = channel;
        this.maxFileSize = (maxFileSizeMb ?? 10) * 1024 * 1024;
    }
    write(payload) {
        const event = {
            id: this.nextId++,
            ts: Date.now(),
            channel: this.channel,
            payload,
        };
        const line = JSON.stringify(event) + '\n';
        try {
            const stats = statSync(this.filePath);
            if (stats.size >= this.maxFileSize) {
                renameSync(this.filePath, this.filePath + '.1');
                writeFileSync(this.filePath, '');
            }
        }
        catch {
            // File might not exist yet
        }
        appendFileSync(this.filePath, line);
        return event;
    }
    resetId() {
        this.nextId = 1;
    }
    getLastId() {
        return this.nextId - 1;
    }
}
export class BufferedNdjsonWriter extends NdjsonWriter {
    flushIntervalMs;
    buffer = [];
    timer = null;
    constructor(filePath, channel, maxFileSizeMb, flushIntervalMs = 100) {
        super(filePath, channel, maxFileSizeMb);
        this.flushIntervalMs = flushIntervalMs;
    }
    writeBuffered(payload) {
        const event = {
            id: 0,
            ts: Date.now(),
            channel: 'network',
            payload,
        };
        this.buffer.push(JSON.stringify({ ...event, id: 0 }));
        if (!this.timer) {
            this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
        }
        return event;
    }
    flush() {
        if (this.buffer.length === 0)
            return;
        for (const _line of this.buffer) {
            const parsed = JSON.parse(_line);
            this.write(parsed.payload);
        }
        this.buffer = [];
        this.timer = null;
    }
    destroy() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.flush();
        }
    }
}
//# sourceMappingURL=base.js.map