import type { RpcStub } from 'capnweb'

type ServerStub = {
  onConsole(data: any): Promise<void>
}

type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug'

/**
 * Patch console methods to send events to server via RPC
 * @param serverStub - RPC stub to server's ServerApi
 */
export function patchConsole(serverStub: RpcStub<ServerStub>): void {
  // Save original console methods
  const origConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  }

  // Helper to serialize arguments
  function serializeArgs(args: any[]): string[] {
    return args.map((arg) => {
      try {
        const str = typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2)
        // Truncate at 2000 chars
        return str.length > 2000 ? str.slice(0, 2000) + '…' : str
      } catch {
        return String(arg)
      }
    })
  }

  // Helper to get stack trace
  function getStack(): string | undefined {
    try {
      throw new Error()
    } catch (e: any) {
      return e.stack
    }
  }

  // Patch each console method
  function createPatch(level: ConsoleLevel) {
    return function (...args: any[]) {
      // Call original console method first (browser still sees output)
      origConsole[level](...args)

      // Send to server via RPC (fire-and-forget)
      serverStub
        .onConsole({
          level,
          args: serializeArgs(args),
          ts: Date.now(),
          // Include stack for errors
          stack: level === 'error' ? getStack() : undefined,
        })
        .catch(() => {
          // Silently fail if RPC not available
        })
    }
  }

  // Apply patches
  console.log = createPatch('log')
  console.warn = createPatch('warn')
  console.error = createPatch('error')
  console.info = createPatch('info')
  console.debug = createPatch('debug')

  // Log confirmation (window check for TypeScript)
  if (typeof (globalThis as any).window !== 'undefined') {
    console.log('[next-live-dev-mcp] Console patching enabled')
  }
}
