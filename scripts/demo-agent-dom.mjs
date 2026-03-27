#!/usr/bin/env node
// Demo: AI agent browsing Hacker News via capnweb remote DOM
//
// Prerequisites:
//   1. Gateway running:  npx web-dev-mcp --port 3333
//   2. Browser open to:  http://localhost:3333/https://news.ycombinator.com/
//
// This script connects as an agent, reads the front page, finds a story,
// navigates to its comments, and reads the top comment — all via live
// remote DOM access. No eval, no CSP issues, promise-pipelined.

import { connect } from '../packages/gateway/dist/agent-client.js'

const browser = await connect('ws://localhost:3333/__rpc/agent')
const { document } = browser

console.log('Connected. Browsers:', await browser.getBrowserCount())
console.log()

// Read the page title
console.log('Page:', await document.title)
console.log()

// Get all story titles — walk the DOM remotely
const stories = []
for (let i = 1; i <= 5; i++) {
  // HN structure: .athing rows with .titleline links
  const row = document.querySelector(`.athing:nth-child(${i * 3 - 2}) .titleline a`)
  try {
    const text = await row.textContent
    const href = await row.href
    stories.push({ text, href })
    console.log(`${i}. ${text}`)
  } catch {
    break
  }
}

console.log()

// Find "DOOM Over DNS" and navigate to its comments
const doomLink = document.querySelector('a[href*="doom-over-dns"]')
const doomTitle = await doomLink.textContent
console.log(`Found: "${doomTitle}"`)

// Traverse: story row → next sibling (subtext) → comments link
// This whole chain is pipelined — capnweb sends it as batched RPCs
const subRow = doomLink.closest('tr').nextElementSibling
const subText = await subRow.querySelector('.subline').textContent
console.log(`Subtext: ${subText.trim()}`)

// Get the comments link href and click it
const allSubLinks = subRow.querySelectorAll('.subline a')
// The comments link is the last one with "comment" in its text
// We'll grab by href pattern since it matches the item page
const commentsHref = await doomLink.closest('tr').nextElementSibling
  .querySelector('a[href^="item"]')
  .href
console.log(`Comments URL: ${commentsHref}`)

// Navigate to comments
console.log()
console.log('Navigating to comments...')
await browser.navigate(commentsHref)

// After navigation the browser reconnects RPC — reconnect agent too
browser.close()
await new Promise(r => setTimeout(r, 3000))

const page2 = await connect('ws://localhost:3333/__rpc/agent')

console.log('Page:', await page2.document.title)
console.log()

// Get the top comment text
try {
  const text = await page2.document.querySelector('.commtext').textContent
  console.log('Top comment:', text.substring(0, 300))
} catch {
  console.log('(comments not loaded)')
}

console.log()
console.log('Done.')
page2.close()
