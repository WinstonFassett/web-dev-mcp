/**
 * Browser instrumentation for Next.js apps
 *
 * Loaded automatically via webpack entry injection, or manually via:
 *   import 'web-dev-mcp/nextjs/instrument'  // in instrumentation-client.ts (Turbopack)
 *
 * Config is passed via Next.js env (works with both webpack and Turbopack).
 */
const GATEWAY_URL = process.env.WEB_DEV_MCP_GATEWAY || 'http://localhost:3333';
const NETWORK_ENABLED = process.env.WEB_DEV_MCP_NETWORK === 'true';
// Mark instrument as loaded (use distinct flag so client.js guard isn't tripped)
if (typeof window !== 'undefined') {
    ;
    window.__WEB_DEV_MCP_INSTRUMENT__ = true;
    window.__WEB_DEV_MCP_GATEWAY__ = GATEWAY_URL;
}
// WebSocket connection for events
let eventsWs = null;
const eventQueue = [];
let connected = false;
function connectEvents() {
    // Connect via same origin — Next.js rewrites proxy WebSocket upgrades to the gateway
    const wsUrl = `${location.origin.replace(/^http/, 'ws')}/__events`;
    try {
        eventsWs = new WebSocket(wsUrl);
        eventsWs.onopen = () => {
            connected = true;
            console.log('[web-dev-mcp] Connected to events stream');
            // Flush queued events
            while (eventQueue.length > 0) {
                const event = eventQueue.shift();
                eventsWs?.send(JSON.stringify(event));
            }
        };
        eventsWs.onclose = () => {
            connected = false;
            console.log('[web-dev-mcp] Disconnected, reconnecting in 2s...');
            setTimeout(connectEvents, 2000);
        };
        eventsWs.onerror = (err) => {
            console.error('[web-dev-mcp] WebSocket error:', err);
        };
    }
    catch (err) {
        console.error('[web-dev-mcp] Failed to connect:', err);
        setTimeout(connectEvents, 2000);
    }
}
function sendEvent(channel, payload) {
    const event = { channel, payload };
    if (connected && eventsWs) {
        eventsWs.send(JSON.stringify(event));
    }
    else {
        eventQueue.push(event);
        if (eventQueue.length > 1000)
            eventQueue.shift(); // Prevent memory leak
    }
}
// Patch console methods
const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
};
function patchConsole() {
    ;
    ['log', 'warn', 'error', 'info', 'debug'].forEach((level) => {
        console[level] = function (...args) {
            // Call original
            originalConsole[level].apply(console, args);
            // Send to gateway
            sendEvent('console', {
                level,
                args: args.map((arg) => {
                    try {
                        if (typeof arg === 'string')
                            return arg;
                        return JSON.stringify(arg).slice(0, 2000); // Truncate large objects
                    }
                    catch {
                        return String(arg);
                    }
                }),
                stack: level === 'error' || level === 'warn' ? new Error().stack : null,
            });
        };
    });
}
// Error handlers
function setupErrorHandlers() {
    window.addEventListener('error', (event) => {
        sendEvent('errors', {
            type: 'unhandled-exception',
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack,
        });
    });
    window.addEventListener('unhandledrejection', (event) => {
        sendEvent('errors', {
            type: 'unhandled-rejection',
            reason: String(event.reason),
            promise: event.promise,
            stack: event.reason?.stack,
        });
    });
}
// Load the eval bridge client script (enables eval_in_browser via rewrites)
function loadClientScript() {
    const script = document.createElement('script');
    script.src = '/__client.js';
    script.async = true;
    document.head.appendChild(script);
}
// Network interception (opt-in)
function patchNetwork() {
    if (!NETWORK_ENABLED)
        return;
    const originalFetch = window.fetch;
    window.fetch = async function (url, options) {
        const startTime = Date.now();
        const method = options?.method || 'GET';
        try {
            const response = await originalFetch.call(this, url, options);
            const duration = Date.now() - startTime;
            sendEvent('network', {
                type: 'fetch',
                method,
                url: String(url),
                status: response.status,
                statusText: response.statusText,
                duration,
            });
            return response;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            sendEvent('network', {
                type: 'fetch',
                method,
                url: String(url),
                status: 0,
                statusText: 'Failed',
                duration,
                error: String(error),
            });
            throw error;
        }
    };
    // Patch XMLHttpRequest
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
        const xhr = new OriginalXHR();
        const startTime = Date.now();
        let method = 'GET';
        let url = '';
        const originalOpen = xhr.open;
        xhr.open = function (m, u, async = true, username, password) {
            method = m;
            url = String(u);
            // Call original with all arguments (cast to any to avoid TypeScript overload issues)
            return originalOpen.call(this, m, u, async, username, password);
        };
        const originalSend = xhr.send;
        xhr.send = function (body) {
            xhr.addEventListener('loadend', () => {
                const duration = Date.now() - startTime;
                sendEvent('network', {
                    type: 'xhr',
                    method,
                    url,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    duration,
                });
            });
            return originalSend.call(this, body);
        };
        return xhr;
    };
}
// Initialize on load
if (typeof window !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            patchConsole();
            setupErrorHandlers();
            patchNetwork();
            connectEvents();
            loadClientScript();
        });
    }
    else {
        patchConsole();
        setupErrorHandlers();
        patchNetwork();
        connectEvents();
        loadClientScript();
    }
}
export {};
//# sourceMappingURL=instrument.js.map