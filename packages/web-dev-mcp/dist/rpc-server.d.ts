import { RpcTarget, type RpcStub } from 'capnweb';
import { type WebSocket as WsWebSocket } from 'ws';
export interface BrowserStub {
    id: string;
    getPageInfo(): Promise<{
        id: string;
        title: string;
        url: string;
        type: string;
    }>;
    cdpConnect(callback: RpcTarget): Promise<boolean>;
    cdpSend(message: string): Promise<void>;
    cdpDisconnect(): Promise<void>;
    eval(expression: string): Promise<string>;
    queryDom(selector: string, options: {
        max_depth?: number;
        attributes?: string[];
        text_length?: number;
    }): Promise<{
        html: string;
        element_count: number;
        truncated: boolean;
    }>;
}
export declare function getBrowserStub(): RpcStub<BrowserStub> | undefined;
export declare function getBrowserStubCount(): number;
export declare function getBrowserByAlias(alias: 'first' | 'latest'): RpcStub<BrowserStub> | undefined;
export declare function getBrowserById(browserId: string): RpcStub<BrowserStub> | undefined;
export declare function getBrowsersByServer(serverId: string): RpcStub<BrowserStub>[];
export declare function getLatestBrowserByServer(serverId: string): RpcStub<BrowserStub> | undefined;
export declare function getAllBrowsers(): Array<{
    connId: string;
    browserId: string | null;
    serverId: string | null;
    connectedAt: number;
}>;
export declare function waitForBrowser(timeoutMs?: number): Promise<RpcStub<BrowserStub>>;
export declare function setupRpcWebSocket(httpServer: {
    on(event: string, listener: (...args: any[]) => void): void;
}, rpcPath: string): import("ws").Server<typeof WsWebSocket, typeof import("node:http").IncomingMessage>;
//# sourceMappingURL=rpc-server.d.ts.map