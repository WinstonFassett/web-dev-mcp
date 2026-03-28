// Admin UI for web-dev-mcp gateway
// Served at /__admin (HTML) and /__admin/api (JSON)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAllBrowsers } from './rpc-server.js'
import { getMcpSessionCount } from './mcp-server.js'
import type { ServerRegistry } from './registry.js'

export function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  opts: { startedAt: number; registry: ServerRegistry; port: number },
): boolean {
  if (url === '/__admin/api') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      uptime_ms: Date.now() - opts.startedAt,
      mode: opts.registry.size() > 0 ? 'hybrid' : 'hub',
      browsers: getAllBrowsers(),
      servers: opts.registry.getAll(),
      mcp_sessions: getMcpSessionCount(),
    }))
    return true
  }

  if (url === '/__admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(adminHtml(opts.port))
    return true
  }

  return false
}

function adminHtml(port: number) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>web-dev-mcp gateway</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin-bottom: 1.5rem; color: #fff; }
  h2 { font-size: 1rem; color: #888; margin: 1.5rem 0 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .stats { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .stat { background: #1a1a1a; border: 1px solid #333; border-radius: 6px; padding: 0.5rem 1rem; }
  .stat .label { font-size: 0.75rem; color: #888; }
  .stat .value { font-size: 1.2rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.8rem; border-bottom: 1px solid #222; font-size: 0.85rem; }
  th { color: #888; font-weight: 500; }
  td { color: #ccc; }
  .clickable { cursor: pointer; } .clickable:hover { background: #1a1a1a; }
  .empty { color: #555; font-style: italic; padding: 1rem 0; }
  #logs { margin-top: 1rem; }
  #logs pre { background: #111; border: 1px solid #333; border-radius: 4px; padding: 0.5rem; font-size: 0.8rem; max-height: 300px; overflow-y: auto; white-space: pre-wrap; }
  .log-error { color: #f55; } .log-warn { color: #fa0; } .log-info { color: #5af; }
  #repl { margin-top: 1.5rem; }
  #repl textarea { width: 100%; height: 80px; background: #111; color: #0f0; border: 1px solid #333; border-radius: 4px; padding: 0.5rem; font-family: monospace; font-size: 0.85rem; resize: vertical; }
  #repl button { margin-top: 0.5rem; padding: 0.4rem 1rem; background: #333; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  #repl button:hover { background: #444; }
  #repl-result { margin-top: 0.5rem; padding: 0.5rem; background: #111; border-radius: 4px; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; min-height: 1.5rem; color: #0f0; }
</style>
</head><body>
<h1>web-dev-mcp gateway</h1>
<div id="stats" class="stats"></div>

<h2>Connected Browsers</h2>
<div id="browsers"></div>

<div id="logs" style="display:none">
  <h2>Logs <span id="logs-browser" style="color:#5af"></span></h2>
  <pre id="logs-content"></pre>
</div>

<h2>Registered Servers</h2>
<div id="servers"></div>

<div id="repl">
  <h2>eval_js_rpc</h2>
  <textarea id="code" placeholder="return await document.title">return await document.title</textarea>
  <button onclick="runEval()">Run</button>
  <div id="repl-result"></div>
</div>

<script>
const API = '/__admin/api'
const MCP = '/__mcp'
let selectedBrowser = null

async function refresh() {
  try {
    const d = await (await fetch(API)).json()

    document.getElementById('stats').innerHTML =
      stat('Uptime', formatMs(d.uptime_ms)) +
      stat('Mode', d.mode) +
      stat('Browsers', d.browsers.length) +
      stat('Servers', d.servers.length) +
      stat('MCP Sessions', d.mcp_sessions)

    const brows = d.browsers
    document.getElementById('browsers').innerHTML = brows.length === 0
      ? '<div class="empty">No browsers connected</div>'
      : '<table><tr><th>ID</th><th>Server</th><th>Connected</th><th></th></tr>' +
        brows.map(b => {
          const bid = b.browserId || b.connId
          const sel = bid === selectedBrowser ? ' style="background:#1a1a2a"' : ''
          return '<tr class="clickable"' + sel + ' onclick="showLogs(\\'' + bid + '\\')">' +
            '<td>' + bid.slice(0,12) + '</td>' +
            '<td>' + (b.serverId || '-') + '</td>' +
            '<td>' + ago(b.connectedAt) + '</td>' +
            '<td>' + (bid === selectedBrowser ? '◀' : '') + '</td></tr>'
        }).join('') +
        '</table>'

    document.getElementById('servers').innerHTML = d.servers.length === 0
      ? '<div class="empty">No servers registered</div>'
      : '<table><tr><th>ID</th><th>Type</th><th>Port</th><th>Name</th></tr>' +
        d.servers.map(s => '<tr><td>' + s.id + '</td><td>' + s.type + '</td><td>' + s.port + '</td><td>' + (s.name || '-') + '</td></tr>').join('') +
        '</table>'
  } catch {}
}

let logStream = null

function showLogs(browserId) {
  selectedBrowser = browserId
  document.getElementById('logs').style.display = ''
  document.getElementById('logs-browser').textContent = browserId.slice(0,12)
  document.getElementById('logs-content').innerHTML = '<span class="empty">Listening...</span>'

  // Close previous stream
  if (logStream) logStream.close()

  // Connect SSE filtered by browser
  logStream = new EventSource('/__admin/events?browser_id=' + encodeURIComponent(browserId))
  logStream.addEventListener('log', e => {
    const d = JSON.parse(e.data)
    const el = document.getElementById('logs-content')
    if (el.querySelector('.empty')) el.innerHTML = ''
    const p = d.payload
    const cls = p.level === 'error' ? 'log-error' : p.level === 'warn' ? 'log-warn' : ''
    const time = new Date().toLocaleTimeString()
    const text = p.args ? p.args.join(' ') : (p.message || JSON.stringify(p))
    el.innerHTML += '<div class="' + cls + '">[' + time + '] <b>' + d.channel + '</b> ' + escHtml(text) + '</div>'
    el.scrollTop = el.scrollHeight
  })
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function stat(l, v) { return '<div class="stat"><div class="label">' + l + '</div><div class="value">' + v + '</div></div>' }
function formatMs(ms) { return ms < 60000 ? Math.round(ms/1000) + 's' : ms < 3600000 ? Math.round(ms/60000) + 'm' : Math.round(ms/3600000) + 'h' }
function ago(ts) { return formatMs(Date.now() - ts) + ' ago' }

// MCP connection
let mcpUrl = null, mcpResolvers = {}, mcpId = 1

function connectMcp() {
  const es = new EventSource(MCP + '/sse')
  es.addEventListener('endpoint', e => {
    mcpUrl = e.data
    fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: mcpId++, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'admin', version: '0.1' } } })
    }).then(() => fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }))
  })
  es.addEventListener('message', e => {
    try { const m = JSON.parse(e.data); if (m.id && mcpResolvers[m.id]) { mcpResolvers[m.id](m); delete mcpResolvers[m.id] } } catch {}
  })
}

function mcpCall(method, params) {
  const id = mcpId++
  return new Promise((res, rej) => {
    mcpResolvers[id] = res
    setTimeout(() => { delete mcpResolvers[id]; rej(new Error('timeout')) }, 15000)
    fetch(mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  })
}

async function runEval() {
  const el = document.getElementById('repl-result')
  el.textContent = 'Running...'
  try {
    const r = await mcpCall('tools/call', { name: 'eval_js_rpc', arguments: { code: document.getElementById('code').value } })
    el.textContent = r?.result?.content?.[0]?.text || 'undefined'
  } catch (e) { el.textContent = 'Error: ' + e.message }
}

connectMcp()
refresh()
setInterval(refresh, 5000)  // Stats only — logs stream via SSE
</script>
</body></html>`
}
