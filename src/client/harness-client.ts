// Browser shim — injected as virtual module at dev time
// Patches console.*, window error handlers, and optionally fetch/XHR
// All events relayed to server via import.meta.hot.send()
//
// NOTE: This file is served as a virtual module. Vite does NOT run TypeScript
// transforms on virtual modules, so this must be valid JavaScript (no TS syntax).

if (import.meta.hot) {
  // --- Console patching ---
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  }

  const LEVELS = ['log', 'warn', 'error', 'info', 'debug']

  for (const level of LEVELS) {
    console[level] = (...args) => {
      // Call original first
      originalConsole[level](...args)

      // Serialize args, truncate each at 2000 chars
      const serializedArgs = args.map((arg) => {
        try {
          const s = typeof arg === 'string' ? arg : JSON.stringify(arg)
          return s && s.length > 2000 ? s.slice(0, 2000) + '…' : (s ?? String(arg))
        } catch {
          return String(arg)
        }
      })

      const payload = { level, args: serializedArgs }

      // For errors, capture stack
      if (level === 'error' && args[0] instanceof Error) {
        payload.stack = args[0].stack
      }

      import.meta.hot.send('harness:console', payload)

      // Also send to errors channel for console.error
      if (level === 'error') {
        import.meta.hot.send('harness:error', {
          type: 'console-error',
          message: serializedArgs.join(' '),
          stack: payload.stack,
        })
      }
    }
  }

  // --- Unhandled exception handler ---
  window.addEventListener('error', (event) => {
    import.meta.hot.send('harness:error', {
      type: 'unhandled-exception',
      message: event.message,
      stack: event.error?.stack,
      file: event.filename,
      line: event.lineno,
    })
  })

  // --- Unhandled rejection handler ---
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    import.meta.hot.send('harness:error', {
      type: 'unhandled-rejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  // --- React adapter (opt-in, controlled by __HARNESS_REACT__ flag) ---
  if (globalThis.__HARNESS_REACT__) {
    import('virtual:vite-harness-react-adapter')
  }

  // --- Network patching (opt-in, controlled by __HARNESS_NETWORK__ flag) ---
  if (globalThis.__HARNESS_NETWORK__) {
    const EXCLUDE_PATTERNS = globalThis.__HARNESS_NETWORK_EXCLUDE__ || [
      '/__',
      '/@',
      '/node_modules',
    ]

    function shouldExclude(url) {
      return EXCLUDE_PATTERNS.some((p) => url.includes(p))
    }

    // Patch fetch
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (shouldExclude(url)) return originalFetch(input, init)

      const start = performance.now()
      const response = await originalFetch(input, init)
      const duration = Math.round(performance.now() - start)

      import.meta.hot.send('harness:network', {
        method: (init?.method ?? 'GET').toUpperCase(),
        url,
        status: response.status,
        duration,
        initiator: 'fetch',
      })

      return response
    }

    // Patch XMLHttpRequest
    const XHROpen = XMLHttpRequest.prototype.open
    const XHRSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__harness_method = method
      this.__harness_url = typeof url === 'string' ? url : url.href
      return XHROpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (body) {
      const url = this.__harness_url
      if (shouldExclude(url)) return XHRSend.call(this, body)

      const start = performance.now()
      this.addEventListener('loadend', () => {
        import.meta.hot.send('harness:network', {
          method: (this.__harness_method ?? 'GET').toUpperCase(),
          url,
          status: this.status,
          duration: Math.round(performance.now() - start),
          initiator: 'xhr',
        })
      })
      return XHRSend.call(this, body)
    }
  }
}
