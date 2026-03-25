import type { HarnessEvent } from '../types.js';
export declare class NdjsonWriter {
    private filePath;
    private channel;
    private nextId;
    private maxFileSize;
    constructor(filePath: string, channel: string, maxFileSizeMb?: number);
    write(payload: unknown): HarnessEvent;
    resetId(): void;
    getLastId(): number;
}
export declare class BufferedNdjsonWriter extends NdjsonWriter {
    private flushIntervalMs;
    private buffer;
    private timer;
    constructor(filePath: string, channel: string, maxFileSizeMb?: number, flushIntervalMs?: number);
    writeBuffered(payload: unknown): HarnessEvent;
    flush(): void;
    destroy(): void;
}
//# sourceMappingURL=base.d.ts.map