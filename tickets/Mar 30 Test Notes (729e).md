---
id: 729e
title: "Mar 30 Test Notes"
status: open
deps: []
links: []
created: 2026-03-31T00:49:47Z
type: task
priority: 2
assignee: Winston Fassett
tags: [task]
---
# Mar 30 Test Notes

Written by Claude Code after some testing and debugging of the web-dev-mcp integration into the test frontend. This is a detailed account of what we did, what worked, what didn't, and lessons learned from using the tools in a real Next.js app.

# web-dev-mcp Integration into test Frontend

**Date**: 2026-03-30
**Branch**: `winston/web-dev-mcp`

## Goal

Unobtrusively install the `web-dev-mcp` browser observability tool into the test Next.js frontend so that only devs who opt in are affected — no `package.json` changes, no lockfile changes, no impact on CI or other developers.

## What We Did

### 1. Optional local config loading in `next.config.ts`

Added a pattern where `next.config.ts` checks for a git-ignored `local.config.js` file and loads it via `require()`. The local config can export either:
- A **wrapper function** `(config) => modifiedConfig` (used for `withWebDevMcp`)
- A **partial config object** (shallow-merged)

Key decisions:
- **CJS `require()`** — Next.js compiles `next.config.ts` to CJS internally, so top-level `await` and dynamic `import()` both fail. `require()` is the only sync option.
- **`.js` extension** — `.mjs` requires dynamic import (async). CJS `.js` works with `require()`.
- **`createRequire(import.meta.url)`** — needed because the config file uses ESM `import` syntax but Next.js compiles to CJS.
- **Don't mutate `nextConfig`** — original version used `Object.assign(nextConfig, ...)` which caused infinite recursion when `withWebDevMcp` wraps `rewrites()` that calls `nextConfig.rewrites()` (now pointing to itself). Fixed by assigning to a new `resolvedConfig` variable.

### 2. Package installation via `pnpm link`

`pnpm link /path/to/web-dev-mcp/packages/adapter-nextjs` creates a symlink in `node_modules` without touching `package.json` or `pnpm-lock.yaml`. Downside: breaks on `pnpm install` and needs re-linking.

The adapter package needed `require` export conditions added to `package.json` because Next.js loads config as CJS and the original exports only had `import`.

### 3. Adapter-nextjs fixes (in web-dev-mcp repo)

**Infinite HMR loop**: The gateway writes `.ndjson` log files to `.web-dev-mcp/` inside the project directory. Webpack was watching these files, detecting changes on every log write, and recompiling in an infinite loop. Fixed by:
- Adding webpack `watchOptions.ignored` in the adapter to exclude `.web-dev-mcp/`
- Had to merge with existing ignored pattern (Next.js sets a RegExp) as a combined RegExp — webpack validation rejects mixed arrays of strings and RegExp

**Server ID mismatch**: Browser wasn't associated with the project because:
- Server registered with `process.pid` of the parent Next.js process
- Browser received the server ID via `NEXT_PUBLIC_WEB_DEV_MCP_SERVER` env var, but the DefinePlugin ran in a forked worker with a different PID
- Fixed by setting `__WEB_DEV_MCP_SERVER__` env var once in the parent; child workers inherit it

**Instrument guard**: `instrument.ts` checked `__WEB_DEV_MCP_LOADED__` (set by the async client script) but the client hadn't loaded yet on HMR cycles. Added a separate `__WEB_DEV_MCP_INSTRUMENT__` flag set synchronously.

**Build error**: Gateway had an unresolvable optional import (`web-dev-mcp-proxy`). Fixed with `as string` cast to suppress tsc.

## What Didn't Work

1. **Top-level `await`** — Next.js compiles config to CJS. `await import()` fails.
2. **`export default getConfig()` (promise)** — unclear if Next.js resolves raw promises from config (vs async function export). Didn't pursue.
3. **`.mjs` local config** — can't be `require()`'d. ESM dynamic import needs async context.
4. **`npm i -g`** — global installs aren't resolvable by `require()` in the project context.
5. **Mixed array for `watchOptions.ignored`** — webpack validates that arrays are all strings. Next.js sets a RegExp, so mixing types fails. Must combine into a single RegExp.
6. **Mutating `nextConfig` with `Object.assign`** — `withWebDevMcp` wraps functions like `rewrites()` that call `nextConfig.rewrites()`. If we mutate `nextConfig` to point at the wrapped config, the wrapped `rewrites()` calls itself infinitely.

## Lessons Learned: Agent Using web-dev-mcp

These are observations from an LLM agent (Claude) using the web-dev-mcp tools in a real session against a production-grade Next.js app.

### 1. Always `return` in `eval_js_rpc`
Code runs as a function body. Without `return`, result is always `"undefined"`. Wasted several calls before figuring this out. The skill doc is clear about it but it's easy to forget.
- `return await document.title` — works
- `await document.title` — returns `"undefined"`

**Tool improvement**: Auto-wrap single expressions in `return(...)`. Or if result is `"undefined"`, add a hint: "Did you forget `return`?"

### 2. `browser.eval()` only takes expressions, not statements
`browser.eval('const x = ...; ...')` fails with "Unexpected token". It wraps the arg in `return (...)`, so only expressions work. Multi-statement logic needs IIFE or functional style.
- Works: `browser.eval('JSON.stringify(Array.from(...))')`
- Fails: `browser.eval('const cats = ...; JSON.stringify(cats)')`

**Tool improvement**: Document this clearly. Or detect statements and auto-wrap in IIFE.

### 3. `browser.screenshot()` overflows LLM context
Returns base64 JSON (76k+ chars even for thumbnails). The tool result limit rejected it. Even if it fit, sending base64 text to an LLM is wasteful — the LLM can't see the image from text.

**Tool improvement**: Write image to a temp file, return the path. The LLM can then `Read` the image file (Claude Code renders images visually from `Read`).

### 4. `get_diagnostics()` overflows on chatty apps
PostHog alone generated enough log volume that a single `get_diagnostics()` returned 108k chars and got rejected. Must `clear` frequently and always use `since_checkpoint: true`.

**Tool improvement**: Default to `since_checkpoint: true`. Add a `max_bytes` cap. Consider excluding known-noisy sources (PostHog, analytics SDKs) by default or offering a noise filter.

### 5. Tailing NDJSON files is better than MCP for high-volume logs
For a chatty app, reading `.web-dev-mcp/console.ndjson` directly with `tail` + `jq` filtering is far more efficient than pulling everything through the MCP tool. Useful patterns:
```bash
# Skip PostHog noise
tail -5 .web-dev-mcp/console.ndjson | jq 'select(.payload.args[0] | startswith("[PostHog") | not)'
# Errors only
tail -f .web-dev-mcp/errors.ndjson | jq .
```

### 6. `text=` selector matches wrong elements
`browser.click('text=containerstore.com')` matched a `<script>` tag. `browser.click('text=Activate')` matched a nav item instead of the intended sidebar link. Text matching is greedy and doesn't filter invisible or non-interactive elements.

**Workaround**: Use CSS selectors with `href` or `data-testid` when available: `browser.click('a[href*="/activation"]')`.

**Tool improvement**: `text=` should skip `<script>`, `<style>`, `<noscript>`. Consider `a:text=Activate` syntax to constrain by tag.

### 7. `browser.markdown()` is the best first call for page content
Returns structured content with links, headings, form elements. Much better than raw `innerText` for understanding page structure. Use it as the default "what's on screen?" call.

### 8. `browser.click()` is the right nav method for SPAs
For Next.js client-side routing, clicking nav links preserves the SPA session and RPC connection. `browser.navigate()` causes a full page load, disconnects RPC, and requires waiting. Always prefer click for in-app navigation.

### 9. `set_project` first, `clear` before testing
Always call `set_project` at session start. Always call `clear` before a test-fix cycle so `get_diagnostics(since_checkpoint: true)` only shows new events. This is the core workflow loop:
```
set_project → clear → (make code change) → get_diagnostics({since_checkpoint: true})
```

### 10. capnweb proxy chains need `await` at each read
Each property access on `document`/`window` is an RPC round-trip. Must `await` each value read. But method calls can chain without intermediate `await` (promise pipelining) — the final `await` resolves the whole chain.

## Commits

### the-test-nextjs-app
- `88ea50f0` — `chore: ignore local.*`
- `824f93b9` — `chore: add local configuration support in next.config.ts`
- `b99a2da4` — `chore: update local configuration import to use dynamic import syntax`
- `c216795d` — `fix: local config` (sync require approach)
- `f5ab7579` — `chore: gitignore .web-dev-mcp/ log directory`

### web-dev-mcp
- `8afd5b4` — `fix(adapter-nextjs): prevent infinite HMR loop from gateway log writes`
- `903e47b` — `fix(adapter-nextjs): use stable server ID across Next.js worker forks`

## Files Modified

### the-test-nextjs-app
- `frontend/next.config.ts` — optional local config loading
- `frontend/.gitignore` — ignore `local.*` and `.web-dev-mcp/`
- `frontend/local.config.js` — personal, git-ignored, wraps config with `withWebDevMcp`

### web-dev-mcp
- `packages/adapter-nextjs/package.json` — added `require` export conditions
- `packages/adapter-nextjs/src/index.ts` — webpack watch exclusion, stable server ID
- `packages/adapter-nextjs/src/instrument.ts` — separate HMR guard flag
- `packages/gateway/src/gateway.ts` — tsc fix for optional import
