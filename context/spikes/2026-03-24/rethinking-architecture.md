# Rethinking Architecture: Universal Web Development MCP Proxy

**Date:** 2026-03-24
**Status:** Research & Design
**Goal:** Generalize vite-live-dev-mcp to work with any web framework

---

## Executive Summary

**Problem:** vite-live-dev-mcp works great for Vite but is framework-specific. Can we generalize it to a universal web development proxy with MCP that works for Next.js, Rails, static sites - anything?

**Answer:** Yes. Build HTTP proxy with script injection + reuse our existing RPC/MCP architecture. The core tech (capnweb, MCP tools, NDJSON logs) is framework-agnostic. Only the injection method needs to change.

**Recommendation:** Build gateway pattern from start. Single long-running process serving all dev servers is more elegant than running multiple proxy instances per project. MCP connections survive dev server restarts, multi-project support is natural, and resource usage is minimal. Doesn't need full daemon complexity - just a persistent gateway process.

---

## Current Architecture Issues

1. **MCP connections die on restart** - Dev server restarts → connections lost → agents confused
2. **Tight coupling** - Our MCP server lives inside dev server process
3. **Custom server required** - Can't use standard `next dev`
4. **Single dev server** - Can't handle multiple projects simultaneously

## Standalone Runtime Architecture (like portless)

This is a much better design:

```
llm/agent
    ↓ (persistent MCP connection)
dev-server-mcp (standalone process on :3333)
    ├─→ Auto-discovers dev servers
    ├─→ Proxies HTTP/WS to detected servers
    ├─→ Handles browser RPC (__rpc endpoint)
    └─→ Manages NDJSON log files
    
Next.js :3000 ← proxy
Vite :5173    ← proxy  
Other :4000   ← proxy

Browser connects to dev-server-mcp RPC

```

**Key benefits:**

* MCP stays alive when Next.js/Vite restarts
* Multi-project: manage all dev servers from one MCP
* Standard dev commands: `next dev`, `vite`, no custom server
* Portless integration: `myapp.localhost` routes through the proxy

## Plugin Architecture

```
// Core: dev-server-mcp
interface DevServerAdapter {
  name: 'nextjs' | 'vite' | 'remix' | ...
  detect(): Promise<ServerInfo | null>  // Auto-discover running server
  
  // Platform capabilities
  getBuiltinMCP?(): string              // Next.js: /_next/mcp
  getLogFile?(): string                 // Next.js: .next/dev/logs/...
  injectBrowserClient?(): InjectConfig  // How to inject our client
}

// Next.js adapter
class NextJsAdapter implements DevServerAdapter {
  async detect() {
    // Scan for processes, check for .next dir
    return { port: 3000, url: 'http://localhost:3000' }
  }
  
  getBuiltinMCP() {
    return '/_next/mcp'  // Proxy this through
  }
  
  injectBrowserClient() {
    return {
      method: 'middleware',  // or 'transform' for Vite
      code: "import 'dev-server-mcp/client'"
    }
  }
}

```

## Middleware Approach for Injection

For Next.js middleware (to avoid custom server):

```
// middleware.ts (in user's Next.js app)
import { NextResponse } from 'next/server'

export function middleware(request) {
  const response = NextResponse.next()
  
  // Inject client script via response header
  if (request.nextUrl.pathname === '/') {
    const html = await response.text()
    const injected = html.replace(
      '<head>',
      '<head><script src="http://mcp.localhost:3333/__client.js"></script>'
    )
    return new NextResponse(injected, response)
  }
  
  return response
}

```

**Problem:** Edge runtime limitations - can't modify HTML easily

**Better:** HTML transform plugin (Turbopack/webpack)

## Proposed Implementation Strategy

**Phase 1: Standalone runtime**

1. Create `dev-server-mcp` as separate package
2. Runs on fixed port (3333)
3. Auto-discovers Next.js/Vite servers
4. Proxies requests through
5. Injects browser client via HTML transform
6. Handles RPC + MCP endpoints

**Phase 2: Platform adapters**

1. Next.js adapter (detects port, proxies `/_next/mcp`)
2. Vite adapter (existing vite-live-dev-mcp code)
3. Generic adapter (for unknown servers)

**Phase 3: Portless integration**

1. Register with portless for named URLs
2. `mcp.localhost` → dev-server-mcp
3. `myapp.localhost` → proxied Next.js

## Key Questions

1. **Client injection:** How to inject browser client without custom server?

   * Vite: Transform plugin ✅ (we have this)
   * Next.js: Turbopack loader or middleware? Need to explore
2. **Proxy pattern:** HTTP + WebSocket proxying

   * Could use http-proxy library
   * Maintain connection map (URL patterns → backends)
3. **Discovery:** How to detect running dev servers?

   * Process scanning (like Vercel's next-devtools-mcp)
   * File watching (.next/, .vite/ directories)
   * Manual registration via config

Would you want to:

* **A)** Build the standalone runtime first (dev-server-mcp package)
* **B)** Explore Next.js middleware injection to eliminate custom server
* **C)** Both - standalone runtime + research middleware patterns

The standalone runtime feels like the bigger win architecturally. Want me to sketch out the core implementation?

what is most elegant and powerful? sounds like it could be phase 1, but how does it auto discover things? how would users use it



1.
2.
3.



##



*
*
*
*
*



*
*
*
*



*
*
*
*
*



*
*
*
*
*



*
*
*
*

##



```
```



```
```

















Great question! Let me think through the most elegant approach:

## Most Elegant: Phase 1 Standalone with Smart Discovery

**User experience:**

```
# Terminal 1: Start once, runs forever
npx dev-server-mcp
# → MCP server on :3333
# → Auto-discovers dev servers
# → Persistent connections

# Terminal 2: Standard Next.js (no custom server!)
cd my-app
npm run dev
# → Detected automatically
# → Browser client injected
# → Available at localhost:3000

# LLM/Agent
# → Connects to localhost:3333/__mcp
# → Sees all detected servers
# → Connection survives Next.js restarts

```

## Auto-Discovery: Multi-Method Approach

**1. Process scanning** (like Vercel does)

```
// Scan every 5s for node processes
async scanProcesses() {
  const procs = await findProcess('name', 'node')
  
  for (const proc of procs) {
    // Next.js: "node .../next-cli.js dev"
    if (proc.cmd.includes('next') && proc.cmd.includes('dev')) {
      const port = extractPortFromCmd(proc.cmd) || 3000
      this.registerServer({ type: 'nextjs', port })
    }
    
    // Vite: "vite" or "vite dev"
    if (proc.cmd.includes('vite')) {
      const port = extractPortFromCmd(proc.cmd) || 5173
      this.registerServer({ type: 'vite', port })
    }
  }
}

```

**2. Port probing** (fallback)

```
// Probe common ports every 10s
async probeCommonPorts() {
  for (const port of [3000, 3001, 5173, 8080, 4200]) {
    try {
      const res = await fetch(`http://localhost:${port}`)
      
      // Detect framework from response
      if (res.headers.get('x-powered-by')?.includes('Next.js')) {
        this.registerServer({ type: 'nextjs', port })
      } else if (await this.isVite(port)) {
        this.registerServer({ type: 'vite', port })
      }
    } catch {}
  }
}

```

**3. File system watching**

```
// Watch for .next, .vite directories
const watcher = chokidar.watch([
  '*/.next',
  '*/.vite', 
  '*/vite.config.*',
  '*/next.config.*'
], { persistent: true })

watcher.on('add', async (path) => {
  // Found a Next.js project
  if (path.includes('.next')) {
    const projectDir = path.split('.next')[0]
    // Read package.json to get dev server info
  }
})

```

**4. Registration API** (opt-in, fastest)

```
// Dev servers can POST to register themselves
app.post('/__register', (req, res) => {
  const { type, port, name } = req.body
  this.registerServer({ type, port, name })
  res.json({ success: true })
})

// In Next.js server.js (optional):
await fetch('http://localhost:3333/__register', {
  method: 'POST',
  body: JSON.stringify({
    type: 'nextjs',
    port: 3000,
    name: 'my-app'
  })
})

```

## Architecture: Standalone Proxy

```
// packages/dev-server-mcp/src/index.ts

import http from 'http'
import httpProxy from 'http-proxy'
import { createMcpMiddleware } from './mcp.js'
import { createRpcServer } from './rpc.js'
import { DevServerRegistry } from './registry.js'

class DevServerMCP {
  private registry = new DevServerRegistry()
  private proxy = httpProxy.createProxyServer()
  
  async start(port = 3333) {
    const server = http.createServer((req, res) => {
      // MCP endpoint
      if (req.url?.startsWith('/__mcp')) {
        return this.handleMCP(req, res)
      }
      
      // Client script injection
      if (req.url === '/__client.js') {
        return this.serveClient(req, res)
      }
      
      // Proxy to detected servers
      const target = this.registry.findByHost(req.headers.host)
      if (target) {
        // Intercept HTML responses to inject client
        this.proxy.web(req, res, { 
          target: target.url,
          selfHandleResponse: true
        })
        
        this.proxy.on('proxyRes', (proxyRes, req, res) => {
          if (this.isHTML(proxyRes)) {
            this.injectClient(proxyRes, res, target)
          } else {
            proxyRes.pipe(res)
          }
        })
      }
    })
    
    // WebSocket for RPC
    server.on('upgrade', (req, socket, head) => {
      if (req.url === '/__rpc') {
        this.handleRPC(req, socket, head)
      } else {
        // Proxy WS to target server
        const target = this.registry.findByHost(req.headers.host)
        if (target) {
          this.proxy.ws(req, socket, head, { target: target.url })
        }
      }
    })
    
    server.listen(port, () => {
      console.log(`dev-server-mcp running on :${port}`)
    })
    
    // Start discovery
    this.startDiscovery()
  }
  
  startDiscovery() {
    // Combine all methods
    this.scanProcesses()
    this.probeCommonPorts()
    this.watchFilesystem()
    
    setInterval(() => this.scanProcesses(), 5000)
    setInterval(() => this.probeCommonPorts(), 10000)
  }
}

```

## With Portless Integration

```
// Auto-register with portless when servers detected
async registerServer(server: DetectedServer) {
  this.registry.add(server)
  
  // Register with portless if available
  if (this.portlessEnabled) {
    await fetch('http://localhost:8000/__internal/routes', {
      method: 'POST',
      body: JSON.stringify({
        // my-app.localhost → proxy to :3000
        host: `${server.name}.localhost`,
        target: `http://localhost:${server.port}`
      })
    })
  }
}

```

## Config File (optional)

```
// dev-server-mcp.json
{
  "servers": [
    {
      "name": "my-next-app",
      "type": "nextjs",
      "port": 3000,
      "cwd": "./my-next-app"
    },
    {
      "name": "my-vite-app", 
      "type": "vite",
      "port": 5173,
      "cwd": "./my-vite-app"
    }
  ],
  "mcp": {
    "port": 3333
  },
  "portless": true
}

```

## User Flow

**Zero config (auto-discovery):**

```
npx dev-server-mcp    # Starts, scans for servers
cd my-app && npm run dev    # Detected automatically

```

**With config (explicit):**

```
npx dev-server-mcp --config ./dev-server-mcp.json

```

**With portless:**

```
npx dev-server-mcp --portless
# → my-app.localhost
# → mcp.localhost/__mcp

```

## Most Powerful Features

1. **Survives restarts** - MCP connection persists
2. **Multi-project** - Manage multiple dev servers
3. **Zero config** - Auto-discovers most setups
4. **Standard commands** - No custom server needed
5. **Platform agnostic** - Works with Next.js, Vite, Remix, etc.

Want me to start building this? I'd create:

1. Basic proxy + discovery
2. MCP endpoint that lists detected servers
3. Client injection via HTML transform
4. RPC endpoint for browser interaction

forget portless itself. i was more talking about how portless seems to use some sort of background daemon / proxy that all portless connects to







1.
2.
3.
4.
5.





```
```



1.
2.
3.
4.





*
*
*
*
*



*
*
*
*
*



Ah yes! You're talking about the **persistent daemon architecture** that portless uses. Let me explain that pattern:

## Portless Daemon Architecture

```
System startup
    ↓
portless daemon starts (background process)
    ↓ listens on :80 or :443
    ↓ accepts registration from dev servers
    ↓
Dev server 1 starts
    ↓ registers with daemon: "myapp → :3000"
    ↓
Dev server 2 starts  
    ↓ registers with daemon: "api → :4000"
    ↓
Daemon proxies:
    myapp.localhost → localhost:3000
    api.localhost → localhost:4000
    ↓
Dev server 1 restarts → daemon keeps running

```

**Key aspects:**

1. **Long-running daemon** - Independent Node.js process
2. **Registration protocol** - Dev servers POST their config to daemon
3. **Survives restarts** - Daemon outlives dev servers
4. **Single entry point** - All traffic goes through daemon

## Applying This to dev-server-mcp

Same pattern but for MCP instead of DNS:

```
npx dev-server-mcp start-daemon
    ↓ starts background process
    ↓ listens on :3333
    ↓ MCP endpoint at :3333/__mcp
    ↓ RPC endpoint at :3333/__rpc
    ↓
Next.js starts
    ↓ detects daemon running
    ↓ registers: "next dev on :3000"
    ↓
Vite starts
    ↓ detects daemon running
    ↓ registers: "vite on :5173"
    ↓
LLM connects to :3333/__mcp
    ↓ persistent connection
    ↓
Next.js restarts → LLM connection stays alive

```

## Implementation Details

**1. Daemon management**

```
// packages/dev-server-mcp/src/daemon.ts

export class DevServerMCPDaemon {
  private pidFile = os.tmpdir() + '/dev-server-mcp.pid'
  private sockFile = os.tmpdir() + '/dev-server-mcp.sock'
  
  async start() {
    // Check if already running
    if (await this.isRunning()) {
      console.log('Daemon already running')
      return
    }
    
    // Fork background process
    const child = spawn('node', [
      path.join(__dirname, 'daemon-process.js')
    ], {
      detached: true,      // Run independently
      stdio: 'ignore'      // Don't attach to parent
    })
    
    child.unref()          // Allow parent to exit
    
    // Write PID file
    fs.writeFileSync(this.pidFile, child.pid.toString())
    
    console.log(`Daemon started (PID: ${child.pid})`)
  }
  
  async stop() {
    const pid = await this.getPid()
    if (pid) {
      process.kill(pid)
      fs.unlinkSync(this.pidFile)
    }
  }
  
  async isRunning() {
    const pid = await this.getPid()
    if (!pid) return false
    
    try {
      process.kill(pid, 0)  // Check if process exists
      return true
    } catch {
      return false
    }
  }
  
  async getPid() {
    try {
      return parseInt(fs.readFileSync(this.pidFile, 'utf8'))
    } catch {
      return null
    }
  }
}

```

**2. Registration protocol**

```
// Dev servers register with daemon via HTTP

// In daemon-process.ts
app.post('/__internal/register', (req, res) => {
  const { type, port, name, pid } = req.body
  
  registry.add({
    type,
    port,
    name,
    pid,
    registeredAt: Date.now()
  })
  
  res.json({ success: true })
})

// Watch for dead processes
setInterval(() => {
  for (const server of registry.getAll()) {
    try {
      process.kill(server.pid, 0)  // Check if alive
    } catch {
      registry.remove(server.pid)  // Clean up dead entry
    }
  }
}, 5000)

```

**3. Dev server auto-registration**

```
// In Next.js/Vite dev server startup

async function registerWithDaemon() {
  // Check if daemon is running
  try {
    await fetch('http://localhost:3333/__internal/ping')
  } catch {
    // Daemon not running, start it
    await startDaemon()
  }
  
  // Register this server
  await fetch('http://localhost:3333/__internal/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'nextjs',
      port: 3000,
      name: 'my-app',
      pid: process.pid
    })
  })
}

```

**4. IPC for efficiency** (optional)

```
// Use Unix socket instead of HTTP for local registration
// Faster, more efficient

const server = net.createServer((socket) => {
  socket.on('data', (data) => {
    const msg = JSON.parse(data.toString())
    
    if (msg.type === 'register') {
      registry.add(msg.server)
      socket.write(JSON.stringify({ success: true }))
    }
  })
})

server.listen(this.sockFile)

```

## User Experience

**Starting daemon:**

```
# Start daemon (runs in background)
npx dev-server-mcp daemon start

# Check status
npx dev-server-mcp daemon status
# → Running (PID: 12345)
# → MCP: http://localhost:3333/__mcp
# → Servers: 2 registered

# Stop daemon
npx dev-server-mcp daemon stop

```

**Auto-start on first use:**

```
cd my-next-app
npm run dev

# On startup, Next.js checks for daemon
# If not running, starts it automatically
# Registers itself with daemon
# → Daemon: localhost:3333
# → Next.js: localhost:3000 (registered)

```

**Multi-project:**

```
# Terminal 1
cd project-a && npm run dev
# → Registered with daemon

# Terminal 2
cd project-b && npm run dev
# → Also registered with daemon

# Terminal 3
npx dev-server-mcp list
# → project-a (next) - :3000
# → project-b (vite) - :5173

# LLM connects once to daemon
# Can interact with both projects

```

## Key Benefits of Daemon Pattern

1. **Persistent connections** - MCP stays alive through restarts
2. **Auto-start** - First dev server starts daemon if needed
3. **Multi-project** - Single daemon handles all projects
4. **Clean shutdown** - Daemon cleans up dead registrations
5. **System-wide** - One daemon per machine, not per project

## Implementation Priority

Want me to build this? Suggested order:

1. **Basic daemon** - Start/stop, PID management
2. **Registration API** - Dev servers can register
3. **MCP endpoint** - Expose tools, list servers
4. **Auto-discovery** - Fallback if registration doesn't happen
5. **RPC proxy** - Browser connections through daemon

This is much more powerful than per-project servers!


---


---

## Research Findings: Prior Art

### Mature HTTP Proxies (No MCP)

**BrowserSync** (17k⭐, 2013) - Established the pattern
- Proxy mode wraps any dev server
- Script injection: `<script src='/browser-sync/browser-sync-client.js'></script>`  
- Live reload via WebSocket
- **Lesson:** Proven that proxy + injection works universally

**http-proxy-middleware** (13k⭐, Node.js) - Most popular
- Used by Webpack/Vite ecosystems
- `responseInterceptor` for HTML modification
- WebSocket support built-in
- **Lesson:** Battle-tested foundation we can use

**Mockttp** (1.4k⭐, TypeScript) - HTTP Toolkit's core
- MITM proxy with response transformation
- Certificate handling for HTTPS
- **Lesson:** Production-quality proxy in TypeScript

**mitmproxy** (36k⭐, Python) - Industry standard
- Streaming architecture, addon system
- **Lesson:** Gold standard for reference

### MCP + Browser Tools

**Microsoft Playwright MCP** - Official
- Browser automation via Playwright
- **Gap:** Launches separate browser, not observing dev browser

**Chrome DevTools MCP** - Google
- Exposes CDP to AI agents
- **Gap:** Automation focus, not dev observability

**agnt** (Go, standardbeagle/agnt)
- Reverse proxy + frontend instrumentation + MCP
- Error tracking, real device testing
- **Gap:** Go (we want TypeScript), but architecture is sound to study

**Key Insight:** No mature "persistent proxy + live browser observability + MCP" in TypeScript exists. This is a real gap we can fill.

### Technical Patterns

**Session Recording:**
- **rrweb** (16k⭐) - Industry standard, NDJSON format
- MutationObserver for DOM changes
- 20-25% CPU overhead (acceptable for dev tools)
- Can add later without architecture changes

**Script Injection:**
1. HTML transform: `html.replace('</head>', '<script src="..."></script></head>')`
2. Streaming: trumpet + CSS selectors (more complex)
3. Buffering: Load full response, modify, send (simpler for MVP)

**Communication:**
1. WebSocket (capnweb) - Bidirectional RPC (we have this)
2. SSE - Unidirectional streaming for dashboard (MCP already uses this)

---

## Architecture Options

### Option 1: Gateway Pattern (Recommended)

**Concept:** Single long-running gateway process

```bash
npx web-dev-mcp start
# Long-running process, survives dev server restarts
# Auto-discovers Next.js, Vite, etc.
# Single MCP endpoint for all projects
```

**Pros:** MCP persists, multi-project, efficient (one process not N), powerful, simpler than full daemon
**Cons:** Need to keep terminal open (or use tmux/screen, or optionally daemonize)

**Why gateway from start:** Running multiple proxy instances (one per project) is wasteful. Single gateway serving all dev servers is more elegant and natural.

### Option 2: Simple Proxy (Alternative)

**Concept:** Run proxy per project

```bash
cd my-next-app
npx web-dev-mcp --target http://localhost:3000
# Proxy on :8080
# Visit localhost:8080 (proxied + instrumented)
# LLM connects to localhost:8080/__mcp
```

**Pros:** Simple, explicit, can proxy remote servers
**Cons:** MCP dies on proxy restart, wasteful (duplicate processes per project), no multi-project support

### Option 3: Keep vite-live-dev-mcp + Add Universal Proxy

**Concept:** Specialized integrations + universal fallback

**Pros:** Optimal per-framework, universal coverage
**Cons:** More packages to maintain

---

## Recommended Approach

**Build Gateway Pattern from Start (Option 1)**

### MVP: Long-Running Gateway with Multi-Project Support

Core features:
- Long-running gateway process (simple, not full daemon)
- HTTP proxy with script injection (http-proxy-middleware)
- Auto-discovery (process scanning + port probing)
- Registration API (dev servers can register)
- Bidirectional RPC (reuse capnweb from vite plugin)
- MCP server (reuse tools from vite plugin)
- NDJSON log files (reuse writers)
- Multi-project support (single gateway, multiple dev servers)

What gets reused from vite-live-dev-mcp:
- ✅ `src/client/*` - Console patching, error handlers, network interception, RPC client
- ✅ `src/writers/*` - ConsoleWriter, ErrorsWriter, NetworkWriter
- ✅ `src/mcp-server.ts` - All MCP tool definitions
- ✅ `src/rpc-server.ts` - RPC endpoint handling
- ✅ `src/session.ts` - Session management
- ✅ `src/log-reader.ts` - Query/filter logic

What's new:
- ❌ Dev server registry (track multiple projects)
- ❌ HTTP proxy setup (replace Vite plugin hooks)
- ❌ HTML injection logic (replace transform hooks)
- ❌ Client bundling (need to serve `/__client.js`)
- ❌ Auto-discovery (process scanning + port probing)

User experience:
```bash
# Terminal 1: Start gateway (long-running)
npx web-dev-mcp start
# → Gateway on :3333
# → MCP at :3333/__mcp

# Terminal 2+: Start dev servers (auto-discovered)
cd project-a && npm run dev  # → Auto-registered
cd project-b && npm run dev  # → Auto-registered

# LLM connects once
# → localhost:3333/__mcp
# → Can interact with all projects
# → Connections survive dev server restarts
```

### Phase 2: Optional Enhancements

After MVP validation:
- Web dashboard (React + react-lazylog)
- Session recording (rrweb integration)
- React DevTools (bippy integration)
- HTTPS/certificate handling
- Remote dev server proxying

---

## Technical Decisions

### Proxy Library: http-proxy-middleware

```typescript
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware'

const proxy = createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
  selfHandleResponse: true,
  ws: true, // WebSocket support
  on: {
    proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      const contentType = proxyRes.headers['content-type'] || ''
      if (contentType.includes('text/html')) {
        let html = buffer.toString('utf8')
        html = html.replace('</head>', '<script src="http://localhost:8080/__client.js"></script></head>')
        return html
      }
      return buffer
    })
  }
})
```

### Package Structure

```
packages/
  web-dev-mcp/
    src/
      proxy.ts          # NEW: HTTP proxy setup
      inject.ts         # NEW: HTML injection logic
      bundle.ts         # NEW: Bundle client code
      cli.ts            # NEW: CLI entry point
    client/             # COPIED: From vite plugin
      index.ts
      console.ts
      errors.ts
      network.ts
      rpc.ts
    core/               # COPIED: From vite plugin
      session.ts
      writers/
      log-reader.ts
      mcp-server.ts
      rpc-server.ts
```

### User Experience

```bash
# Terminal 1: Start dev server (any framework)
npm run dev

# Terminal 2: Start MCP proxy
npx web-dev-mcp --target http://localhost:3000

# Browser: Visit localhost:8080 (proxied)
# LLM: Connect to localhost:8080/__mcp

# Available tools:
# - eval_in_browser
# - query_dom  
# - get_console_logs
# - get_diagnostics
# - wait_for_condition
# etc.
```

---

## Next Steps

1. ✅ Document findings (this file)
2. ⬜ Create `packages/web-dev-mcp/` package
3. ⬜ Copy core code from vite-live-dev-mcp
4. ⬜ Implement dev server registry (track multiple projects)
5. ⬜ Implement HTTP proxy with injection
6. ⬜ Implement auto-discovery (process scanning + port probing)
7. ⬜ Bundle client code for serving
8. ⬜ Test with Next.js test app
9. ⬜ Test with static HTML
10. ⬜ Test with Vite (should still work)
11. ⬜ Test multi-project scenario
12. ⬜ Document usage patterns
13. ⬜ (Optional) Add daemonize flag for background mode

---

## Open Questions

1. **HTTPS support?** Most dev servers use HTTP. Can add later if needed.
2. **Auto-detection fallback?** Daemon has process scanning + port probing. Should we also support explicit `--target` registration?
3. **Web dashboard?** Nice to have, not critical for MVP (LLMs are primary interface).
4. **Session per-project or shared?** Should each project get its own log dir, or single shared dir with project tags?
5. **React DevTools?** Phase 2 feature.

---

## Key Insights

**Architecture:** The vite-live-dev-mcp architecture is fundamentally sound and framework-agnostic. The work is:
1. Extract core code into reusable modules ✅
2. Add HTTP proxy layer for injection ⚡ (new)
3. Add dev server registry for multi-project ⚡ (new)
4. Bundle client code for serving ⚡ (new)
5. Keep everything else the same

**Deployment:** Single long-running gateway process serving all dev servers on the machine is more elegant and efficient than per-project proxies. This isn't about full daemon complexity (PID files, detached processes) - just a simple persistent gateway that acts as the single entry point for MCP + browser instrumentation. 

This is refactoring + small additions, not net-new architecture.

