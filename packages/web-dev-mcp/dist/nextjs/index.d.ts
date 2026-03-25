interface NextConfig {
    webpack?: (config: any, options: any) => any;
    rewrites?: () => Promise<any> | any;
    [key: string]: any;
}
export interface WebDevMcpOptions {
    gatewayUrl?: string;
    enabled?: boolean;
    network?: boolean;
}
export declare function withWebDevMcp(nextConfig?: NextConfig, options?: WebDevMcpOptions): NextConfig;
export {};
//# sourceMappingURL=index.d.ts.map