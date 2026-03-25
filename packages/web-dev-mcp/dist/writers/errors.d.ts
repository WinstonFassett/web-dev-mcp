import type { ErrorPayload } from '../types.js';
export declare class ErrorsWriter {
    private writer;
    constructor(filePath: string, maxFileSizeMb?: number);
    write(payload: ErrorPayload): import("../types.js").HarnessEvent;
    resetId(): void;
}
//# sourceMappingURL=errors.d.ts.map