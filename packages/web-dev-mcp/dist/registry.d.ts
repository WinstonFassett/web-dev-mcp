/**
 * Server Registry - tracks dev servers registered with the gateway
 */
export interface RegisteredServer {
    id: string;
    type: 'vite' | 'nextjs' | 'generic';
    port: number;
    pid: number;
    name?: string;
    rpcEndpoint?: string;
    mcpEndpoint?: string;
    logPaths?: Record<string, string>;
    registeredAt: number;
}
export declare class ServerRegistry {
    private servers;
    private connectionOrder;
    add(server: RegisteredServer): void;
    remove(id: string): void;
    get(id: string): RegisteredServer | undefined;
    getAll(): RegisteredServer[];
    getByType(type: RegisteredServer['type']): RegisteredServer[];
    getByPort(port: number): RegisteredServer | undefined;
    getLatest(): RegisteredServer | undefined;
    has(id: string): boolean;
    size(): number;
    /**
     * Remove servers whose processes are no longer running
     */
    cleanupDeadServers(): number;
}
//# sourceMappingURL=registry.d.ts.map