import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionState } from './session.js';
import type { DevEventsWriter } from './writers/dev-events.js';
import type { ServerRegistry } from './registry.js';
export interface McpContext {
    session: SessionState;
    connectedClients: number;
    devEventsWriter?: DevEventsWriter;
    registry?: ServerRegistry;
}
export declare function sendNotificationToAll(channel: string, message: string, file: string, hint: string): void;
export declare function createMcpMiddleware(mcpPath: string, ctx: McpContext): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
//# sourceMappingURL=mcp-server.d.ts.map