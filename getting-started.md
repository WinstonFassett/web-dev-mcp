# Getting Started with web-dev-mcp

web-dev-mcp gives AI agents live browser access during development — console logs, DOM queries, screenshots, form filling, navigation.

There are **4 things to set up**, and they're all independent:

| Step | What | Why |
|------|------|-----|
| 1 | [Install the gateway](#1-install-the-gateway) | The hub that connects agents to browsers |
| 2 | [Hook into your dev app](#2-hook-into-your-dev-app) | Injects the browser client into your pages |
| 3 | [Add the MCP server to your agent](#3-add-the-mcp-server-to-your-agent) | Gives the agent browser tools |
| 4 | [Add the skill (Claude Code)](#4-add-the-skill-claude-code-only) | Teaches the agent *how* to use the tools |

---

## 1. Install the gateway

The gateway is a lightweight local server (`:3333`) that routes between agents and browsers.

**Global install** (recommended — use across all projects):

```bash
npm install -g @winstonfassett/web-dev-mcp-gateway
```

Then start it with:

```bash
web-dev-mcp
```

**Or run without installing:**

```bash
npx @winstonfassett/web-dev-mcp-gateway
```

> The gateway must be running for everything else to work. Framework adapters (step 2) auto-start it, so you often don't need a separate terminal.

---

## 2. Hook into your dev app

The gateway needs a client script injected into your pages. Pick your framework:

### Vite

```bash
npm install -D @winstonfassett/web-dev-mcp-vite @winstonfassett/web-dev-mcp-gateway
```

```ts
// vite.config.ts
import { webDevMcp } from '@winstonfassett/web-dev-mcp-vite'

export default defineConfig({
  plugins: [webDevMcp()],
})
```

### Storybook (Vite-based)

```bash
npm install -D @winstonfassett/web-dev-mcp-vite @winstonfassett/web-dev-mcp-gateway
```

```ts
// .storybook/main.ts
export default {
  addons: ['@winstonfassett/web-dev-mcp-vite/storybook'],
}
```

### Next.js (Webpack)

```bash
npm install -D @winstonfassett/web-dev-mcp-nextjs @winstonfassett/web-dev-mcp-gateway
```

```js
// next.config.js
import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'
export default withWebDevMcp({ /* your config */ })
```

That's it — client injection happens via webpack entry.

### Next.js (Turbopack)

Same install and config wrapper as above, plus one extra step — Turbopack can't inject via webpack entry, so add the init component to your layout:

```tsx
// app/layout.tsx
import { WebDevMcpInit } from '@winstonfassett/web-dev-mcp-nextjs/init'

export default function RootLayout({ children }) {
  return (
    <html><body>
      <WebDevMcpInit />
      {children}
    </body></html>
  )
}
```

### Any dev server (manual)

No adapter needed. Either:

- **Proxy mode**: browse `http://localhost:3333/http://localhost:YOUR_PORT/` — the gateway proxies and injects automatically.
- **Script tag**: add `<script src="http://localhost:3333/__web-dev-mcp.js"></script>` to your HTML.

> All adapters auto-start the gateway. If you installed globally, the adapter finds it. No separate terminal needed.

---

## 3. Add the MCP server to your agent

The MCP server is an SSE endpoint on the gateway. You need to register it with each AI agent/IDE that should have browser access.

### Auto-register (all agents at once)

```bash
npx @winstonfassett/web-dev-mcp-gateway --auto-register
```

This writes the MCP config into all four locations:
- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.windsurf/mcp.json` (Windsurf)
- `.vscode/mcp.json` (VS Code / Copilot)

### Manual registration

Add to the appropriate config file for your agent:

<details><summary>Claude Code — <code>.mcp.json</code> (project root)</summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "type": "sse",
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>Cursor — <code>.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>Windsurf — <code>.windsurf/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>VS Code (Copilot) — <code>.vscode/mcp.json</code></summary>

```json
{
  "servers": {
    "web-dev-mcp": {
      "type": "sse",
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```

> Note: VS Code uses `"servers"` not `"mcpServers"`.
</details>

---

## 4. Add the skill (Claude Code only)

Skills teach Claude Code *how* to use the MCP tools effectively — workflows, gotchas, best practices.

```bash
npx skills add WinstonFassett/web-dev-mcp --all
```

The `--all` flag installs all skills to all detected agents (Claude Code, Cursor, Windsurf, etc.) in one shot. To target specific agents:

```bash
npx skills add WinstonFassett/web-dev-mcp --agent claude-code cursor
```

This installs the `web-dev-mcp` skill which covers:
- When to call `set_project` and `get_diagnostics`
- How to use `eval_js` with `browser.*` helpers
- Test-fix loop patterns, screenshot workflows, DOM navigation

> Skills are primarily useful for agents that support SKILL.md files (Claude Code, etc.). Other agents still benefit from the MCP tools alone (step 3).

---

## Verify it works

1. Start your dev app (`npm run dev`)
2. Open it in a browser
3. In your agent, run:
   ```
   get_diagnostics
   ```
   You should see console logs, connected browsers, and build status.

---

## Quick reference

| What | Command / Location |
|------|-------------------|
| Start gateway | `web-dev-mcp` or `npx @winstonfassett/web-dev-mcp-gateway` |
| Gateway port | `:3333` (change with `-p`) |
| MCP endpoint | `http://localhost:3333/__mcp/sse` |
| Full toolset (23 tools) | `http://localhost:3333/__mcp/sse?tools=full` |
| Admin UI | `http://localhost:3333` |
| Auto-register MCP | `npx @winstonfassett/web-dev-mcp-gateway --auto-register` |
| Network capture | `web-dev-mcp --network` |

## Troubleshooting

**No browsers connected**: Make sure your dev app is open in a browser *after* the gateway is running. Check the browser console for connection errors.

**Gateway not starting**: Port 3333 may be in use. Check with `lsof -i :3333` or use `-p` to pick a different port.

**MCP tools not appearing in agent**: Restart the agent after adding `.mcp.json`. Some agents require a reload to pick up new MCP servers.

**Turbopack: no logs appearing**: Did you add `<WebDevMcpInit />` to your layout? Turbopack requires the explicit component — the config wrapper alone isn't enough.
