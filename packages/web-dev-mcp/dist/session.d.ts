import type { SessionInfo, GatewayOptions } from './types.js';
export declare function computeSessionId(target: string): string;
export declare function getLogDir(target: string, options: GatewayOptions): string;
export interface SessionState {
    info: SessionInfo;
    logDir: string;
    files: Record<string, string>;
    channels: string[];
    startedAt: number;
    checkpointTs: number | null;
}
export declare function initSession(options: GatewayOptions, serverUrl: string, mcpPath: string): SessionState;
export declare function truncateChannelFiles(files: Record<string, string>, channels?: string[]): Record<string, number>;
//# sourceMappingURL=session.d.ts.map