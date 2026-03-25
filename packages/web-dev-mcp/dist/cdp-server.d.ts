import { type WebSocket as WsWebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'node:http';
export interface CdpContext {
    serverUrl: string;
}
export declare function createCdpMiddleware(ctx: CdpContext): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
export declare function setupCdpWebSocket(httpServer: {
    on(event: string, listener: (...args: any[]) => void): void;
}, _ctx: CdpContext): import("ws").Server<typeof WsWebSocket, typeof IncomingMessage>;
//# sourceMappingURL=cdp-server.d.ts.map