---
id: restart
title: "Gateway restart: CLI subcommand, HTTP endpoint, auto-reload on rebuild"
status: open
deps: []
links: ["729e"]
created: 2026-03-31T01:05:00Z
type: feature
priority: 3
assignee: Winston Fassett
tags: [dx, gateway]
---
# Gateway restart: CLI subcommand, HTTP endpoint, auto-reload on rebuild

During 729e work, every code change required manually finding the PID, killing, and restarting the gateway. Need 3 restart mechanisms:

## 1. CLI subcommand: `npx web-dev-mcp restart`
- Read PID from `/tmp/web-dev-mcp-*.pid` (or `.web-dev-mcp/gateway.pid`)
- Kill, wait for exit, re-launch with same args
- Also: `npx web-dev-mcp stop`

## 2. HTTP endpoint: `POST /__gateway/restart`
- Gateway receives request, responds 200, then execs itself
- Useful for admin UI restart button
- Should re-exec with same argv so flags are preserved

## 3. Auto-reload on rebuild (flag-gated)
- `--watch` flag on `npx web-dev-mcp`
- Watch `dist/` for changes, auto-restart when files change
- Use `fs.watch` or chokidar on `dist/**/*.js`
- Only enabled with explicit `--watch` flag
- Log: "Restarting gateway (dist changed)..."

## Context
Every gateway code change during development currently requires:
1. `ps aux | grep cli.js`
2. `kill <pid>`
3. `node packages/gateway/dist/cli.js --port 3333 &`
4. Restart Next.js (re-register)
5. Hard-refresh browser (new client.js)

Steps 4-5 are inherent but 1-3 should be one command or automatic.
