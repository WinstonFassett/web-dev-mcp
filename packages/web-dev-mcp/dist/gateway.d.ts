import http from 'node:http';
import https from 'node:https';
import type { GatewayOptions } from './types.js';
export declare function startGateway(options: GatewayOptions): Promise<http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> | https.Server<typeof http.IncomingMessage, typeof http.ServerResponse>>;
//# sourceMappingURL=gateway.d.ts.map