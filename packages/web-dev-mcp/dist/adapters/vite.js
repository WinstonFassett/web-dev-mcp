// Vite adapter for web-dev-mcp
// Injects client code natively via Vite's transform hook (no proxy needed)
// Forwards HMR/build events to gateway's /__dev-events WebSocket
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
const __dirname = dirname(fileURLToPath(import.meta.url));
const VIRTUAL_MODULE_ID = 'virtual:web-dev-mcp-client';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;
export function webDevMcp(options = {}) {
    const gatewayUrl = options.gateway ?? 'http://localhost:3333';
    let clientSource;
    let devEventsWs = null;
    function connectDevEvents() {
        const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__dev-events';
        devEventsWs = new WebSocket(wsUrl);
        devEventsWs.on('close', () => {
            devEventsWs = null;
            setTimeout(connectDevEvents, 3000);
        });
        devEventsWs.on('error', () => { });
    }
    function sendBuildEvent(payload) {
        if (devEventsWs && devEventsWs.readyState === WebSocket.OPEN) {
            devEventsWs.send(JSON.stringify(payload));
        }
    }
    return {
        name: 'web-dev-mcp',
        apply: 'serve',
        configResolved(config) {
            ;
            config.server.forwardConsole = false;
        },
        configureServer() {
            connectDevEvents();
        },
        resolveId(id) {
            if (id === VIRTUAL_MODULE_ID)
                return RESOLVED_VIRTUAL_MODULE_ID;
        },
        load(id) {
            if (id === RESOLVED_VIRTUAL_MODULE_ID) {
                if (!clientSource) {
                    // Load the bundled client from dist/
                    const clientPath = join(__dirname, '..', 'client.js');
                    clientSource = readFileSync(clientPath, 'utf-8');
                }
                // Prepend gateway origin so client connects cross-origin
                let preamble = `window.__WEB_DEV_MCP_ORIGIN__ = ${JSON.stringify(gatewayUrl)};\n`;
                if (options.react) {
                    preamble += `window.__WEB_DEV_MCP_REACT__ = true;\n`;
                }
                return preamble + clientSource;
            }
        },
        transform(code, id) {
            if (!id.endsWith('.tsx') && !id.endsWith('.ts') && !id.endsWith('.jsx') && !id.endsWith('.js')) {
                return;
            }
            if (code.includes('createRoot') ||
                code.includes('ReactDOM.render') ||
                code.includes('hydrateRoot')) {
                if (code.includes(VIRTUAL_MODULE_ID))
                    return;
                return {
                    code: `import '${VIRTUAL_MODULE_ID}';\n${code}`,
                    map: null,
                };
            }
        },
        hotUpdate(opts) {
            if (opts.modules.length > 0) {
                sendBuildEvent({
                    type: 'build:update',
                    modules: opts.modules.map((m) => m.id ?? m.url),
                });
            }
        },
    };
}
//# sourceMappingURL=vite.js.map