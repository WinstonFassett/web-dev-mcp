#!/usr/bin/env node
// Test: call_json_rpc MCP tool — raw capnweb protocol messages over persistent session
//
// Prerequisites: gateway running on :3333, browser connected
// Run: node scripts/test-call-json-rpc.mjs

import http from 'http'

const GATEWAY = 'http://localhost:3333'
let sseBuffer = '', resolvers = {}, nid = 1

function connectSSE(base) {
  return new Promise(r => {
    http.get(base + '/__mcp/sse', res => {
      res.on('data', c => {
        sseBuffer += c.toString()
        const parts = sseBuffer.split('\n\n'); sseBuffer = parts.pop()
        for (const p of parts) {
          let ev = '', d = ''
          for (const l of p.split('\n')) {
            if (l.startsWith('event: ')) ev = l.slice(7)
            if (l.startsWith('data: ')) d = l.slice(6)
          }
          if (ev === 'endpoint') r({ url: base + d, res })
          if (ev === 'message') {
            try { const m = JSON.parse(d); if (m.id && resolvers[m.id]) { resolvers[m.id](m); delete resolvers[m.id] } } catch {}
          }
        }
      })
    })
  })
}

function rpc(url, method, params) {
  const id = nid++
  return new Promise((r, j) => {
    resolvers[id] = r
    setTimeout(() => { delete resolvers[id]; j(new Error('timeout')) }, 10000)
    const d = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    const u = new URL(url)
    http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, () => {}).on('error', j).end(d)
  })
}

function tool(url, name, args = {}) { return rpc(url, 'tools/call', { name, arguments: args }) }
function txt(r) { try { return JSON.parse(r?.result?.content?.[0]?.text) } catch { return r?.result?.content?.[0]?.text } }

let passed = 0, failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

const { url, res } = await connectSSE(GATEWAY)
await rpc(url, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0.1' } })
http.request(new URL(url), { method: 'POST', headers: { 'Content-Type': 'application/json' } }, () => {}).end(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))

// Test: tool exists
await test('tool listed', async () => {
  const tools = await rpc(url, 'tools/list', {})
  const names = tools.result.tools.map(t => t.name)
  assert(names.includes('call_json_rpc'), `call_json_rpc not in: ${names.join(', ')}`)
})

// Test: stream message — read document.title
await test('stream: document.title', async () => {
  const r = txt(await tool(url, 'call_json_rpc', {
    messages: ['["stream",["import",0,["document","title"]]]']
  }))
  assert(r.responses, 'no responses')
  assert(r.responses.length > 0, 'empty responses')
  // Parse the capnweb response
  const resp = JSON.parse(r.responses[0])
  assert(resp[0] === 'resolve', `expected resolve, got ${resp[0]}`)
  console.log(`  → title: "${resp[2]}"`)
})

// Test: push + stream — querySelector then read tagName (pipelined, refs persist)
await test('push+stream: querySelector → tagName', async () => {
  const r = txt(await tool(url, 'call_json_rpc', {
    messages: [
      '["push",["import",0,["document","querySelector"],["body"]]]',
      '["stream",["import",1,["tagName"]]]',
    ]
  }))
  const resp = JSON.parse(r.responses[r.responses.length - 1])
  assert(resp[2] === 'BODY', `expected BODY, got ${resp[2]}`)
  console.log(`  → ${resp[2]}`)
})

// Test: refs persist across calls (same MCP session = same capnweb session)
await test('cross-call refs: push in call 1, read in call 2', async () => {
  // Call 1: push querySelector, get import ID
  const r1 = txt(await tool(url, 'call_json_rpc', {
    messages: ['["push",["import",0,["document","querySelector"],["body"]]]']
  }))
  assert(r1.responses, 'no responses from call 1')
  // The push should have assigned an import ID (we don't get it back directly,
  // but the session tracks it). Import 1 should now exist.

  // Call 2: reference import 1 from the previous call
  const r2 = txt(await tool(url, 'call_json_rpc', {
    messages: ['["stream",["import",1,["tagName"]]]']
  }))
  const resp = JSON.parse(r2.responses[r2.responses.length - 1])
  assert(resp[2] === 'BODY', `expected BODY from cross-call ref, got ${resp[2]}`)
  console.log(`  → cross-call ref works: ${resp[2]}`)
})

res.destroy()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
