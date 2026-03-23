/**
 * Browser entry point for next-live-dev-mcp
 * Connects to server via RPC and patches console methods
 */

import { newWebSocketRpcSession } from 'capnweb'
import { patchConsole } from './console-patcher.js'

// Declare window for TypeScript
declare const window: any

// Only run in browser
if (typeof window !== 'undefined') {
  // Connect to RPC server at /__rpc
  const rpcUrl = 'ws://' + window.location.host + '/__rpc'

  console.log('[next-live-dev-mcp] Connecting to RPC server at', rpcUrl)

  try {
    // Create RPC session
    // Browser exports null (no local API for Wave 1)
    // Returns session object with getRemoteMain() method
    const session = newWebSocketRpcSession(rpcUrl, null)
    const serverStub = (session as any).getRemoteMain()

    // Patch console methods to send to server
    patchConsole(serverStub)

    console.log('[next-live-dev-mcp] Connected and initialized')
  } catch (error) {
    console.error('[next-live-dev-mcp] Failed to initialize:', error)
  }
}
