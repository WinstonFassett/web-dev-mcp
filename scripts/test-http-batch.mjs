#!/usr/bin/env node
// Test: HTTP batch capnweb endpoint at /__rpc/batch
//
// Prerequisites: gateway running on :3333, browser connected

import { newHttpBatchRpcSession } from 'capnweb'

const GATEWAY = 'http://localhost:3333'
let passed = 0, failed = 0

async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed')
}

// Helper: get a project-scoped browser handle via batch
function getBrowser() {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  return gw.getProject()
}

// Test: read document.title via batch
await test('batch: document.title', async () => {
  const browser = getBrowser()
  const title = await browser.document.title
  assert(typeof title === 'string' && title.length > 0, `bad title: "${title}"`)
  console.log(`  → "${title}"`)
})

// Test: querySelector chain in one batch
await test('batch: querySelector chain', async () => {
  const browser = getBrowser()
  const text = await browser.document.querySelector('body').textContent
  assert(typeof text === 'string' && text.length > 0, 'empty body text')
  console.log(`  → ${text.length} chars`)
})

// Test: browser.getPageMarkdown helper
await test('batch: getPageMarkdown', async () => {
  const browser = getBrowser()
  const result = await browser.getPageMarkdown()
  assert(result && result.markdown, 'no markdown')
  console.log(`  → ${result.markdown.length} chars`)
})

// Test: getBrowserCount (gateway-level)
await test('batch: getBrowserCount', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const count = await gw.getBrowserCount()
  assert(typeof count === 'number' && count > 0, `expected >0, got ${count}`)
  console.log(`  → ${count} browsers`)
})

// Test: navigate helper
await test('batch: navigate', async () => {
  const browser = getBrowser()
  const result = await browser.navigate('about:blank')
  // navigate returns { navigated } or throws
  console.log(`  → ${JSON.stringify(result)}`)
})

// Test: chained querySelector on page body
await test('batch: querySelector.tagName', async () => {
  const browser = getBrowser()
  // body always exists
  const tag = await browser.document.querySelector('body').tagName
  assert(tag === 'BODY', `expected BODY, got ${tag}`)
  console.log(`  → ${tag}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
