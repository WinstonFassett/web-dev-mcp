import type { NetworkPayload } from '../types.js';
export declare class NetworkWriter {
    private writer;
    constructor(filePath: string, maxFileSizeMb?: number);
    write(payload: NetworkPayload): import("../types.js").HarnessEvent;
    resetId(): void;
    destroy(): void;
}
//# sourceMappingURL=network.d.ts.map