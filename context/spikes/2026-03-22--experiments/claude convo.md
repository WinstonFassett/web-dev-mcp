```markdown
# Vite MCP Browser Bridge — Architecture & Design Notes

## What This Is

An MCP server + Vite plugin that gives AI agents live control of a browser
connected to a Vite dev server — via **injection**, not CDP remote debugging.
The browser connects to the server (through Vite's dev server), not the other
way around. This inversion is the core design insight.

---

## Transport: Cap'n Web (capnweb)

**Repo:** https://github.com/cloudflare/capnweb

JavaScript/TypeScript-native object-capability RPC. Created by the Cap'n Proto
author but designed for the web stack. Key properties:

- **Bidirectional** — server calls browser, browser calls server
- **Pass functions/objects by reference** — pass an `RpcTarget` over the wire,
  the other side gets a stub; calling the stub executes at the origin
- **Promise pipelining** — chain calls without waiting for round trips
- **Works over WebSocket, HTTP batch, MessagePort** — natively
- **No schemas, no boilerplate** — just TypeScript classes extending `RpcTarget`
- Compresses to under 10kB with no dependencies

### Why It's Right For This

The browser exposes a `BrowserAgent extends RpcTarget`. The MCP server holds a
stub. Calling `stub.click(selector)` executes in the browser. Passing a
callback `RpcTarget` to `browser.onEvent(callback)` lets the browser push
unsolicited events (rrweb frames, HMR updates, console logs) to the server
without polling.

```ts
// Browser side (injected via Vite virtual module)
class BrowserAgent extends RpcTarget {
  async eval(code: string) { return eval(code) }
  async click(selector: string) { document.querySelector(selector)?.click() }
  async fill(selector: string, value: string) { ... }
  async snapshot(): Promise<A11yTree> { /* accessibility tree walk */ }
  async screenshot(): Promise<Uint8Array> { ... }
  async waitForHMR(): Promise<void> { /* resolves on vite:afterUpdate */ }

  // server passes a callback stub; browser pushes events to it
  onEvent(callback: RpcTarget & { emit(e: BrowserEvent): void }) {
    window.addEventListener('...', e => callback.emit(e));
  }

  // CDP bridge — see chobitsu section
  cdp(message: string, callback: RpcTarget & { send(msg: string): void }) {
    chobitsu.sendRawMessage(message);
    chobitsu.setTransport(response => callback.send(response));
  }
}
```

```ts
// MCP server side
const browser = newWebSocketRpcSession<BrowserAgent>(wsUrl);

await browser.click('#submit');
const tree = await browser.snapshot();

// Promise pipelining — single round trip
const title = browser.eval('document.title');
await browser.fill('#search', title); // title resolves server-side before delivery
```

---

## CDP In-Browser: Chobitsu

**Repo:** https://github.com/liriliri/chobitsu

Implements Chrome DevTools Protocol domains **entirely in browser JS**. It is
transport-agnostic — you provide a string-in/string-out transport and it handles
the rest.

### Wiring Into BrowserAgent

Chobitsu slots in as the browser-side CDP implementation, bridged over the
existing Cap'n Web connection. No separate transport needed.

```ts
import chobitsu from 'chobitsu';

// inside BrowserAgent
cdp(message: string, callback: RpcTarget & { send(msg: string): void }) {
  chobitsu.sendRawMessage(message);
  chobitsu.setTransport(response => callback.send(response));
}
```

The `callback` stub is an `RpcTarget` passed by reference — chobitsu can push
unsolicited CDP events (like `DOM.documentUpdated`, `Console.messageAdded`)
back to the server without a request/response pairing.

### High-Value CDP Domains Chobitsu Provides

| Domain | Value |
|---|---|
| `Runtime.evaluate` | Full call frame info, exception details |
| `DOM.getDocument` | Complete DOM tree |
| `DOM.querySelector/All` | Server-side element resolution |
| `CSS.getMatchedStylesForNode` | Computed styles, useful for visual regression |
| `Overlay.highlightNode` | Visual debugging — highlight what agent is acting on |
| `Console.*` | Live log streaming to agent |
| `Network.*` | Request interception and inspection |

### Optional: Playwright connectOverCDP Compatibility

If you expose a thin HTTP server that proxies CDP commands to the chobitsu
bridge, a real Playwright process can connect via `connectOverCDP`:

```
GET  /json/version   → { webSocketDebuggerUrl, Browser, ... }
GET  /json           → [{ id, title, url, webSocketDebuggerUrl }]
WS   /devtools/page/:id  → proxy CDP to chobitsu via Cap'n Web
```

```ts
const browser = await chromium.connectOverCDP('http://localhost:9223');
// Playwright now talks to chobitsu running in your live Vite session
```

This gives full Playwright API access on the actual open tab — no browser
launch, no remote debugging flag.

---

## Session Replay: rrweb

Inject rrweb alongside BrowserAgent. Stream events to the server via Cap'n Web:

```ts
import * as rrweb from 'rrweb';

// in BrowserAgent
startRecording(sink: RpcTarget & { emit(e: RrwebEvent): void }) {
  rrweb.record({ emit: e => sink.emit(e) });
}
```

The server accumulates events and can replay them with `rrweb-player`. This
gives session replay for free over the same transport.

---

## MCP Tools Exposed to Agents

| Tool | Calls | Notes |
|---|---|---|
| `browser_eval` | `BrowserAgent.eval()` | Arbitrary JS in browser context |
| `browser_snapshot` | `BrowserAgent.snapshot()` | A11y tree — preferred for agent decisions |
| `browser_click` | `BrowserAgent.click()` | |
| `browser_fill` | `BrowserAgent.fill()` | |
| `browser_screenshot` | `BrowserAgent.screenshot()` | Fallback, a11y preferred |
| `browser_wait_hmr` | `BrowserAgent.waitForHMR()` | Wait for HMR to settle before asserting |
| `browser_record_start` | `BrowserAgent.startRecording()` | Begin rrweb capture |
| `browser_record_stop` | — | Return event log |
| `browser_cdp` | `BrowserAgent.cdp()` | Raw CDP via chobitsu |

---

## Playwright-Shaped Facade (for Agent Familiarity)

Wrap the Cap'n Web stub in a `page`-shaped object so agents can use familiar
Playwright semantics without a Playwright process:

```ts
class PageFacade {
  constructor(private b: RpcStub<BrowserAgent>) {}

  locator(selector: string) { return new LocatorFacade(this.b, selector) }
  getByRole(role: string) { return new LocatorFacade(this.b, `[role="${role}"]`) }
  getByText(text: string) { return new LocatorFacade(this.b, `::-p-text(${text})`) }

  async waitForURL(pattern: string | RegExp) { ... }
  async screenshot() { return this.b.screenshot() }
  async waitForHMR() { return this.b.waitForHMR() } // unique to this tool
}

class LocatorFacade {
  async click() { return this.b.click(this.selector) }
  async fill(value: string) { return this.b.fill(this.selector, value) }
  async textContent() { return this.b.eval(`document.querySelector('${this.selector}').textContent`) }
  async isVisible() { ... }
}
```

---

## Key Playwright APIs Useful for Agents

The subset that matters for agent testing:

```
# Locating (semantic, resilient)
getByRole()        ← best for agents, a11y-first
getByText()
getByTestId()
locator()

# Acting
click(), fill(), press(), selectOption()

# Asserting
toBeVisible(), toHaveText(), toHaveValue()

# Observing
screenshot()
accessibility.snapshot()   ← most important for agent reasoning

# Waiting (critical for SPAs)
waitForURL(), waitForSelector(), locator.waitFor()
waitForHMR()               ← unique advantage of this tool

# Network
waitForResponse(), route()
```

---

## Full Stack Diagram

```
AI Agent / Claude
      ↕ MCP protocol (stdio or SSE)
MCP Server (Node)
      ├── Cap'n Web stub → BrowserAgent methods (direct, semantic)
      ├── CDP proxy route (:9223) → chobitsu via Cap'n Web (Playwright compat)
      └── rrweb event accumulator
      ↕ Cap'n Web over WebSocket (single connection)
Vite Plugin (configureServer hook)
      └── injects browser-runtime as virtual module
Browser (your Vite app)
      └── BrowserAgent (RpcTarget)
              ├── direct methods: eval, click, fill, snapshot, screenshot
              ├── waitForHMR() — listens to vite:afterUpdate
              ├── onEvent(callback) — pushes rrweb, HMR, console to server
              └── cdp(msg, callback) ↔ chobitsu (CDP domains in-browser)
```

---

## Design Rules

- **Never launch a browser.** The browser connects to us via Vite.
- **All browser control goes through the Cap'n Web stub.** Never raw WebSocket.
- **Always `waitForHMR()` before asserting UI** after a code change.
- **A11y snapshot is preferred over screenshot** for agent decision-making.
- **Chobitsu is additive** — direct methods are the fast path, CDP is for power
  use cases or Playwright compat.
- **One transport for everything** — Cap'n Web WS carries direct calls, CDP
  proxy traffic, rrweb streams, and event callbacks simultaneously.

---

## Related Projects

| Project | Role |
|---|---|
| `chobitsu` (liriliri) | CDP implementation in browser JS |
| `chii` (liriliri) | Remote DevTools built on chobitsu |
| `rrweb` | Session recording and replay |
| `@playwright/mcp` | Official Playwright MCP (launches own browser, no Vite integration) |
| `capnweb` (cloudflare) | The RPC transport |
| `rebrowser-playwright` | Playwright fork for existing session attachment |
```