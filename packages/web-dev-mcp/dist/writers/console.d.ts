import type { ConsolePayload } from '../types.js';
export declare class ConsoleWriter {
    private writer;
    constructor(filePath: string, maxFileSizeMb?: number);
    write(payload: ConsolePayload): import("../types.js").HarnessEvent;
    resetId(): void;
}
//# sourceMappingURL=console.d.ts.map