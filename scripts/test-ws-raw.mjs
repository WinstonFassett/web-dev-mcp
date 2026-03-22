#!/usr/bin/env node
// Raw WebSocket test - bypasses Playwright to test the CDP WebSocket directly

import WebSocket from 'ws'

const url = process.argv[2] || 'ws://127.0.0.1:5173/__cdp/devtools/browser'

console.log('Connecting to:', url)

const ws = new WebSocket(url)

ws.on('open', () => {
  console.log('WebSocket opened!')

  // Send a simple CDP command
  const msg = JSON.stringify({
    id: 1,
    method: 'Target.getTargets',
    params: {}
  })
  console.log('Sending:', msg)
  ws.send(msg)
})

ws.on('message', (data) => {
  console.log('Received:', data.toString())
})

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message)
})

ws.on('close', (code, reason) => {
  console.log('WebSocket closed:', code, reason.toString())
})

// Timeout after 5 seconds
setTimeout(() => {
  console.log('Timeout - closing')
  ws.close()
  process.exit(1)
}, 5000)
