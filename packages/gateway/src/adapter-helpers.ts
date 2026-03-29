/**
 * Shared adapter helpers for web-dev-mcp framework adapters.
 * Extracted from duplicated code in Vite and Next.js adapters.
 *
 * Exported as '@winstonfassett/web-dev-mcp-gateway/helpers'
 */

import { spawn } from 'node:child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

// Guard: true while our own code is logging (prevents infinite recursion)
let _internalLogging = false

export function setInternalLogging(value: boolean) {
  _internalLogging = value
}

export interface RegistrationPayload {
  id: string
  type: string
  port: number
  pid: number
  directory: string
}

export interface RegistrationResult {
  serverId: string
  logDir: string
}

/**
 * Register a dev server with the gateway. Returns result on success, null on failure.
 */
export async function registerWithGateway(
  gatewayUrl: string,
  payload: RegistrationPayload,
): Promise<RegistrationResult | null> {
  try {
    const res = await fetch(`${gatewayUrl}/__gateway/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (data.success) {
      return { serverId: data.serverId, logDir: data.logDir }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Register with gateway, retrying every 5s until successful.
 * Calls onRegistered callback once registered.
 */
export function registerWithRetry(
  gatewayUrl: string,
  payload: RegistrationPayload,
  onRegistered?: (result: RegistrationResult) => void,
): { cancel: () => void } {
  let registered = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function tryRegister() {
    if (registered) return
    const result = await registerWithGateway(gatewayUrl, payload)
    if (result) {
      registered = true
      if (timer) { clearInterval(timer); timer = null }
      _internalLogging = true
      console.log(`  [web-dev-mcp] Registered with gateway (server: ${result.serverId}, logs: ${result.logDir})`)
      _internalLogging = false
      onRegistered?.(result)
    }
  }

  tryRegister()
  timer = setInterval(tryRegister, 5000)

  return {
    cancel() {
      if (timer) { clearInterval(timer); timer = null }
    },
  }
}

/**
 * Patch console.log/warn/error/info/debug to forward to the gateway via WebSocket.
 */
export async function patchConsole(gatewayUrl: string, serverId: string): Promise<void> {
  let WS: any
  try {
    WS = (await import('ws')).default
  } catch {
    return
  }

  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__events?server=' + encodeURIComponent(serverId)
  let ws: any = null
  let queue: string[] = []
  let closed = false

  function connect() {
    if (closed) return
    ws = new WS(wsUrl)
    ws.on('open', () => { for (const msg of queue) ws.send(msg); queue = [] })
    ws.on('close', () => { ws = null; if (!closed) setTimeout(connect, 2000) })
    ws.on('error', () => {})
  }
  connect()

  function send(level: string, args: any[]) {
    const serialized = args.map((a: any) => {
      if (typeof a === 'string') return a.slice(0, 2000)
      try { return JSON.stringify(a).slice(0, 2000) } catch { return String(a).slice(0, 2000) }
    })
    const msg = JSON.stringify({
      channel: 'server-console',
      payload: { level, args: serialized, source: 'server' },
    })
    if (ws?.readyState === 1) ws.send(msg)
    else if (queue.length < 1000) queue.push(msg)
  }

  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    const orig = console[level]
    console[level] = (...args: any[]) => {
      orig.apply(console, args)
      if (_internalLogging) return
      const first = args[0]
      if (typeof first === 'string' && (first.startsWith('[web-dev-mcp]') || first.startsWith('  [web-dev-mcp]') || first.startsWith('[registry]'))) return
      send(level, args)
    }
  }

  process.on('exit', () => { closed = true; ws?.close() })
}

export interface DevEventsHandle {
  send: (payload: any) => void
  close: () => void
}

/**
 * Connect to the gateway's dev-events WebSocket for build/HMR events.
 * Returns a handle to send events and close the connection.
 */
export async function connectDevEvents(gatewayUrl: string, serverId: string): Promise<DevEventsHandle> {
  let WS: any
  try {
    WS = (await import('ws')).default
  } catch {
    return { send() {}, close() {} }
  }

  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__dev-events?server=' + encodeURIComponent(serverId)
  let ws: any = null
  let queue: string[] = []
  let closed = false
  let gatewayWarned = false

  function connect() {
    if (closed) return
    ws = new WS(wsUrl)
    ws.on('open', () => {
      for (const msg of queue) ws.send(msg)
      queue = []
      if (gatewayWarned) {
        console.log(`  [web-dev-mcp] Gateway connected at ${gatewayUrl}`)
        gatewayWarned = false
      }
    })
    ws.on('close', () => { ws = null; if (!closed) setTimeout(connect, 3000) })
    ws.on('error', () => {
      if (!gatewayWarned) {
        console.warn(`  [web-dev-mcp] Gateway not running. Start it with: npx web-dev-mcp`)
        gatewayWarned = true
      }
    })
  }
  connect()

  process.on('exit', () => { closed = true; ws?.close() })

  return {
    send(payload: any) {
      const msg = JSON.stringify(payload)
      if (ws?.readyState === 1) ws.send(msg)
      else if (queue.length < 1000) queue.push(msg)
    },
    close() {
      closed = true
      ws?.close()
    },
  }
}

// --- Gateway auto-start ---

function pidFilePath(gatewayUrl: string): string {
  const hash = createHash('md5').update(gatewayUrl).digest('hex').slice(0, 8)
  return join(tmpdir(), `web-dev-mcp-${hash}.pid`)
}

async function isGatewayRunning(gatewayUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${gatewayUrl}/__gateway/status`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    // Fallback: try the register endpoint with a dummy HEAD-like check
    try {
      const res = await fetch(gatewayUrl, { signal: AbortSignal.timeout(2000) })
      return res.ok || res.status === 404 // server is up if it responds at all
    } catch {
      return false
    }
  }
}

/**
 * Ensure the gateway is running. If not, spawn it as a detached process.
 * Returns once the gateway is reachable.
 */
export async function ensureGateway(gatewayUrl: string): Promise<void> {
  if (await isGatewayRunning(gatewayUrl)) return

  const url = new URL(gatewayUrl)
  const port = url.port || '3333'

  _internalLogging = true
  console.log(`  [web-dev-mcp] Starting gateway on port ${port}...`)
  _internalLogging = false

  // Spawn the gateway CLI as a detached process
  const child = spawn('npx', ['web-dev-mcp', '--port', port], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  child.unref()

  // Write PID for stop/restart
  if (child.pid) {
    try {
      writeFileSync(pidFilePath(gatewayUrl), String(child.pid))
    } catch {}
  }

  // Wait for gateway to become reachable (up to 30s — npx cold start can be slow)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (await isGatewayRunning(gatewayUrl)) {
      _internalLogging = true
      console.log(`  [web-dev-mcp] Gateway started (pid: ${child.pid})`)
      _internalLogging = false
      return
    }
  }

  console.warn(`  [web-dev-mcp] Gateway did not start within 30s — continuing without it`)
}

/**
 * Stop a previously auto-started gateway.
 */
export function stopGateway(gatewayUrl: string): boolean {
  const pidFile = pidFilePath(gatewayUrl)
  if (!existsSync(pidFile)) return false
  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
    process.kill(pid, 'SIGTERM')
    unlinkSync(pidFile)
    return true
  } catch {
    try { unlinkSync(pidFile) } catch {}
    return false
  }
}
