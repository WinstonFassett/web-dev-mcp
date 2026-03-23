# CDP + Playwright connectOverCDP Spike

**Date:** 2026-03-22
**Status:** Working (steel thread complete)
**Branch:** `cdp-playwright`

## Goal

Enable Playwright to connect to the browser via `connectOverCDP`, allowing automated testing and interaction with the live dev server without launching a separate browser.

## Architecture

```
Playwright → CDP WebSocket (/__cdp) → Vite Server → capnweb RPC (/__rpc) → Browser → Chobitsu
```

### Key Insight

CDP doesn't require a third WebSocket to the browser. The CDP WebSocket is server-side only — Playwright connects to it, but the server proxies commands to the browser via the existing capnweb RPC channel.

**From browser's perspective (2 WebSockets):**
1. HMR WebSocket (Vite's) — `/`
2. capnweb RPC WebSocket (ours) — `/__rpc`

**From server's perspective (3 WebSocket endpoints):**
1. HMR — Vite manages
2. capnweb RPC — browser connects here
3. CDP — Playwright connects here (not browser)

## Implementation

### Components Added

1. **`src/cdp-server.ts`** — CDP HTTP routes and WebSocket proxy
   - HTTP: `/__cdp/json/version`, `/__cdp/json`, `/__cdp/json/protocol`
   - WebSocket: `/__cdp/devtools/browser`, `/__cdp/devtools/page/:id`
   - Target/Browser domain shims for commands Chobitsu doesn't implement

2. **`src/client/rpc-browser.ts`** — Chobitsu CDP bridge
   - `cdpConnect(callback)` — sets up Chobitsu message handler
   - `cdpSend(message)` — forwards CDP command to Chobitsu
   - `cdpDisconnect()` — cleans up

3. **`src/rpc-server.ts`** — Browser connection tracking
   - Sticky browser IDs via sessionStorage
   - `getBrowserByAlias('first' | 'latest')`
   - `getBrowserById(browserId)`
   - `waitForBrowser(timeoutMs)`

### Key Technical Decisions

**Sticky Browser IDs:** Browser generates ID on first load, stores in sessionStorage. Survives page refreshes but not new tabs. Allows targeting specific browsers.

**prependListener:** CDP upgrade handler uses `prependListener` to run before Vite's HMR WebSocket handler. Otherwise Vite accepts all upgrades first.

**Immediate Message Handler:** CDP WebSocket installs message handler synchronously, queues messages until async setup completes. Prevents race with fast Playwright commands.

**Target Domain Shims:** Playwright sends Target/Browser domain commands that Chobitsu doesn't implement. Server-side shims handle:
- `Target.setDiscoverTargets`, `Target.getTargets`, `Target.attachToTarget`
- `Target.setAutoAttach`, `Target.createBrowserContext`, `Target.disposeBrowserContext`
- `Browser.getVersion`, `Browser.setDownloadBehavior`, `Browser.getWindowForTarget`

## Dependencies

| Dep | Purpose | Required? |
|-----|---------|-----------|
| `chobitsu` | In-browser CDP implementation | Yes (for CDP) |
| `ws` | Node WebSocket server | Yes (CDP external interface) |
| `capnweb` | Object-capability RPC | Yes (browser communication) |

If CDP support not needed, `chobitsu` could be removed and `ws` might be eliminable by moving capnweb RPC over HMR.

## Usage

```javascript
import { chromium } from 'playwright'

// Connect to running Vite dev server
const browser = await chromium.connectOverCDP('http://localhost:5173/__cdp')
const contexts = browser.contexts()
const page = contexts[0].pages()[0]

// Interact with the live page
await page.click('button')
const title = await page.title()
```

## Testing

```bash
# Raw WebSocket test
node scripts/test-ws-raw.mjs ws://localhost:5173/__cdp/devtools/browser

# Full Playwright test
node scripts/test-cdp.mjs http://localhost:5173/__cdp
```

## Challenges Encountered

1. **Middleware registration timing** — Had to register CDP middleware in `configureServer`, not in `listening` callback.

2. **Vite HMR WebSocket priority** — Vite's HMR handler accepts all upgrades. Used `prependListener` to intercept first.

3. **Async setup race** — Playwright sends commands immediately after connect. Had to install message handler sync, queue messages, process after setup.

4. **Missing CDP domains** — Chobitsu implements Page/Runtime/DOM domains but not Target/Browser. Added server-side shims.

## Future Considerations

1. **RPC over HMR** — Could eliminate `/__rpc` WebSocket by tunneling capnweb over Vite's HMR custom events. Would simplify but couples RPC lifecycle to HMR.

2. **Browser reconnection** — When browser refreshes, capnweb RPC reconnects but CDP connection may need to handle this gracefully.

3. **Multiple browsers** — Current design supports multiple connected browsers with `first`/`latest` aliases and ID-based targeting.

## Files Changed

```
src/cdp-server.ts      (new)    CDP HTTP + WebSocket server
src/plugin.ts          (mod)    Wire CDP middleware and WebSocket
src/rpc-server.ts      (mod)    Browser tracking with IDs and aliases
src/client/rpc-browser.ts (mod) Chobitsu CDP bridge methods
package.json           (mod)    Added ws dependency
scripts/test-ws-raw.mjs (new)   Raw WebSocket test utility
```
