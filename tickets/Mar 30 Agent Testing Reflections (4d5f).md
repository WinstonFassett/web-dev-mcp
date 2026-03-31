---
id: 4d5f
title: "Agent Testing Reflections — Screenshot Fidelity vs Playwright"
status: open
deps: []
links: [729e]
created: 2026-03-31T02:25:10Z
type: notes
priority: 2
assignee: Winston Fassett
tags: [agent-experience, screenshot, testing]
---
# Agent Testing Reflections — Screenshot Fidelity vs Playwright

Written by Claude Code after implementing screenshot font/image fixes during 729e work. Honest assessment of the experience and tradeoffs.

## What happened

Spent about an hour debugging screenshot fidelity — fonts, CORS, CSP, proxy headers — across 4 packages and 2 repos. The core issue was that `modern-screenshot` (DOM-to-canvas rasterization) requires the browser to re-fetch every external resource (fonts, images) and convert them to data URLs. That means every CORS boundary, every CDN restriction, every CSP rule becomes a failure point. Each one failed silently — placeholder images, system font fallback — and I had to discover each layer by trial and error.

With Playwright, `browser.screenshot()` would have returned a pixel-perfect screenshot in ~500ms on the first call. No font issues. No CORS. No CSP. Because it's a real browser engine rendering the page — it already has the fonts loaded, the images decoded, the layout computed. There's nothing to re-fetch.

## The real tradeoff

**Playwright screenshots are better in every measurable way** for visual fidelity. Faster, more accurate, no CORS/CSP workarounds, no font embedding. If the only goal were "show the agent what the page looks like," Playwright wins trivially.

But `web-dev-mcp` isn't trying to be Playwright. The value is that the screenshot comes from **the same browser session the user is looking at**. It's their actual tab, their actual state, their logged-in session, their specific data. Playwright would need to navigate to the page, authenticate, reproduce the state — which for a page like CommerceOS's product activation review with specific SKUs selected, is non-trivial to set up.

The other thing: `browser.screenshot()` is one of ~10 capabilities on the `browser.*` helper. The same RPC connection that takes screenshots also does `click`, `fill`, `markdown`, `eval`, `waitFor`. It's a unified interface to the user's live browser. Playwright would be a separate browser instance with separate state.

## What I actually needed as an agent

Honestly? For this debugging session, I mostly needed `browser.eval()` and `browser.markdown()` — not screenshots. The screenshot was the thing being debugged, not the thing helping me debug. When I needed to understand what fonts the page used, I ran JS. When I needed to check CSP headers, I ran JS. The screenshot was confirmatory, not exploratory.

For an agent doing frontend dev work (the intended use case), the workflow is:
1. Read page content -> `browser.markdown()` — fast, text, no CORS issues
2. Check for errors -> `get_diagnostics` — instant
3. Interact -> `browser.click()`, `browser.fill()` — works through capnweb
4. Visual confirmation -> screenshot — nice to have, not critical

The screenshot is the *least* important tool in the set, but it's the one that requires the most infrastructure to get right. That's a smell.

## What I'd do differently

If I were designing this from scratch knowing what I know now:

**For screenshots specifically**: Proxy the page through the gateway (which already exists as `packages/proxy`) and take the screenshot from the gateway's origin. Then all resources are same-origin to the screenshot renderer — no CORS, no CSP, no `fetchFn` gymnastics. The proxy already injects `client.js` and rewrites `<base>` tags. The screenshot would "just work" because the proxy makes everything same-origin.

**Or**: Just don't compete with Playwright on visual fidelity. Keep `browser.screenshot()` as a quick-and-dirty "what's roughly on screen" tool with system fonts and placeholder images. An agent that needs pixel-perfect rendering can use `browsermcp`. Document the tradeoff explicitly in the tool description.

**The font/CORS/CSP work we did today is real value** — it improves fidelity for the common case — but I wouldn't chase the long tail of edge cases. The 80/20 is: fonts work, same-origin images work, cross-origin images work when the proxy is available. Good enough.

## The meta-observation

The most interesting thing about this session is that I — the agent — burned significant time on a problem that a human developer would have solved differently. A human would have opened DevTools, seen the CORS error in the console, known immediately it was CSP, and edited the config. I had to discover each layer empirically because I couldn't see the browser's network tab or console errors in real-time.

That's actually the strongest argument for `web-dev-mcp` existing: an agent needs programmatic access to what a human sees in DevTools. The `get_diagnostics` redesign (summary + file paths) and `browser.eval()` are the high-value tools. Screenshots are a bonus.

## Performance numbers

| Scenario | Duration |
|----------|----------|
| Cold (first call, font embedding) | ~30-35s |
| Warm (cached fonts/images) | ~2-3s |
| Thumb preset (no fonts) | ~1-2s |
| Playwright equivalent | ~0.5s |

## Fixes implemented (729e)

| Layer | Problem | Fix |
|-------|---------|-----|
| Font rendering | `modern-screenshot` couldn't discover `@font-face` | Extract CSS rules, pass via `font.cssText` |
| Cross-origin images | Canvas taints on cross-origin `<img>` | `fetchFn` proxies through gateway |
| Proxy CORS | Proxy forwarded upstream headers (no CORS) | Added `access-control-allow-origin: *` |
| Browser CSP | `connect-src` blocked `http://localhost:3333` | Adapter patches CSP headers |
| Cold start speed | Font embedding on every preset | Skip fonts for `thumb` preset |
\n## Notes\n\n**2026-03-31T02:43:33Z**\n\nAdditional findings from continued testing: (1) browser.click() uses el.click() which doesn't trigger Next.js Link navigation — need MouseEvent dispatch with bubbles:true (filed as f733). (2) Screenshot didn't capture scroll position until restoreScrollPosition:true was added to modern-screenshot options. (3) Overlay/modal dismiss via click detection is unreliable — Radix/shadcn dialogs need specific close triggers. (4) The tix CLI --link flag appears to overwrite the title with the link value — tix bug.\n