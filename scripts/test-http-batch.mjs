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

// Test: read document.title via batch
await test('batch: document.title', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const title = await gw.document.title
  assert(typeof title === 'string' && title.length > 0, `bad title: "${title}"`)
  console.log(`  → "${title}"`)
})

// Test: querySelector chain in one batch
await test('batch: querySelector chain', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const text = await gw.document.querySelector('body').textContent
  assert(typeof text === 'string' && text.length > 0, 'empty body text')
  console.log(`  → ${text.length} chars`)
})

// Test: browser.markdown helper
await test('batch: getPageMarkdown', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const result = await gw.getPageMarkdown()
  assert(result && result.markdown, 'no markdown')
  console.log(`  → ${result.markdown.length} chars`)
})

// Test: getBrowserCount
await test('batch: getBrowserCount', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const count = await gw.getBrowserCount()
  assert(typeof count === 'number' && count > 0, `expected >0, got ${count}`)
  console.log(`  → ${count} browsers`)
})

// Test: navigate helper
await test('batch: navigate', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  const result = await gw.navigate('about:blank')
  // navigate returns { navigated } or throws
  console.log(`  → ${JSON.stringify(result)}`)
})

// Test: chained querySelector on page body
await test('batch: querySelector.tagName', async () => {
  const gw = newHttpBatchRpcSession(`${GATEWAY}/__rpc/batch`)
  // body always exists
  const tag = await gw.document.querySelector('body').tagName
  assert(tag === 'BODY', `expected BODY, got ${tag}`)
  console.log(`  → ${tag}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
