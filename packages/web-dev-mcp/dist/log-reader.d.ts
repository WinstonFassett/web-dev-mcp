import type { HarnessEvent, DiagnosticsResult } from './types.js';
import type { SessionState } from './session.js';
import type { DevEventsWriter } from './writers/dev-events.js';
export interface LogQuery {
    channel: string;
    sinceId?: number;
    limit?: number;
    level?: string;
    search?: string;
}
export interface LogResult {
    events: HarnessEvent[];
    total: number;
    returned: number;
    next_cursor: number;
}
export declare function queryLogs(files: Record<string, string>, query: LogQuery): LogResult;
export interface DiagnosticsQuery {
    since_checkpoint?: boolean;
    since_ts?: number;
    limit?: number;
    level?: string;
    search?: string;
}
export declare function getDiagnostics(files: Record<string, string>, session: SessionState, query: DiagnosticsQuery, devEventsWriter?: DevEventsWriter): DiagnosticsResult;
//# sourceMappingURL=log-reader.d.ts.map