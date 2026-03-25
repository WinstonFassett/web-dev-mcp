export interface BuildEventPayload {
    type: 'build:update' | 'build:error' | 'build:start' | 'build:complete';
    modules?: string[];
    error?: string;
    duration?: number;
}
export declare class DevEventsWriter {
    private writer;
    private lastUpdateAt;
    private lastErrorAt;
    private lastError;
    private updateCount;
    private errorCount;
    private pending;
    constructor(filePath: string, maxFileSizeMb?: number);
    write(payload: BuildEventPayload): import("../types.js").HarnessEvent;
    getStatus(since?: number): {
        last_update_at: number | null;
        last_error_at: number | null;
        last_error: string | undefined;
        update_count: number;
        error_count: number;
        pending: boolean;
    };
    resetId(): void;
    resetCounters(): void;
}
//# sourceMappingURL=dev-events.d.ts.map