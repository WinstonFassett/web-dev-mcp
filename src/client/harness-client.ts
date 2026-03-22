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

  // --- eval_in_browser handler ---
  import.meta.hot.on('harness:eval', (data) => {
    const { expression, requestId } = data
    const start = performance.now()
    try {
      const fn = new Function('return (' + expression + ')')
      const raw = fn()
      // Handle promises
      const finish = (value) => {
        let result
        try {
          result = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          if (result && result.length > 10240) {
            result = result.slice(0, 10240) + '\n…(truncated)'
          }
        } catch {
          result = String(value)
        }
        import.meta.hot.send('harness:eval-response', {
          requestId,
          result: result ?? 'undefined',
          duration_ms: Math.round(performance.now() - start),
        })
      }
      if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
        raw.then(finish).catch((err) => {
          import.meta.hot.send('harness:eval-response', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            duration_ms: Math.round(performance.now() - start),
          })
        })
      } else {
        finish(raw)
      }
    } catch (err) {
      import.meta.hot.send('harness:eval-response', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        duration_ms: Math.round(performance.now() - start),
      })
    }
  })

  // --- query_dom handler ---
  import.meta.hot.on('harness:query-dom', (data) => {
    const {
      selector,
      max_depth = 3,
      attributes = ['id', 'class', 'href', 'src', 'value', 'type', 'placeholder', 'role', 'aria-label'],
      text_length = 100,
      requestId,
    } = data

    try {
      const root = selector ? document.querySelector(selector) : document.body
      if (!root) {
        import.meta.hot.send('harness:query-dom-response', {
          requestId,
          html: '',
          element_count: 0,
          error: 'No element found for selector: ' + selector,
        })
        return
      }

      let elementCount = 0
      const MAX_RESULT_LENGTH = 20480

      function serializeNode(node, depth, indent) {
        if (depth > max_depth) return '…'

        if (node.nodeType === 3) {
          // Text node
          const text = node.textContent.trim()
          if (!text) return ''
          return text.length > text_length ? text.slice(0, text_length) + '…' : text
        }

        if (node.nodeType !== 1) return ''

        const el = node
        const tag = el.tagName.toLowerCase()

        // Skip script, style, svg, noscript
        if (['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(tag)) return ''

        elementCount++
        const pad = '  '.repeat(indent)

        // Build attribute string
        let attrs = ''
        for (const attr of attributes) {
          const val = el.getAttribute(attr)
          if (val !== null && val !== '') {
            // Shorten class lists
            const displayVal = attr === 'class' && val.length > 80
              ? val.slice(0, 80) + '…'
              : val
            attrs += ' ' + attr + '="' + displayVal.replace(/"/g, '&quot;') + '"'
          }
        }

        // Self-closing tags
        if (['br', 'hr', 'img', 'input'].includes(tag)) {
          return pad + '<' + tag + attrs + '/>'
        }

        const children = Array.from(el.childNodes)
        const childStrings = []
        for (const child of children) {
          const s = serializeNode(child, depth + 1, indent + 1)
          if (s) childStrings.push(s)
        }

        // Leaf elements with only text
        if (childStrings.length === 0) {
          const text = el.textContent?.trim() ?? ''
          const truncated = text.length > text_length ? text.slice(0, text_length) + '…' : text
          if (truncated) {
            return pad + '<' + tag + attrs + '>' + truncated + '</' + tag + '>'
          }
          return pad + '<' + tag + attrs + '/>'
        }

        if (childStrings.length === 1 && !childStrings[0].includes('\n') && childStrings[0].length < 80) {
          return pad + '<' + tag + attrs + '>' + childStrings[0].trim() + '</' + tag + '>'
        }

        return pad + '<' + tag + attrs + '>\n' + childStrings.join('\n') + '\n' + pad + '</' + tag + '>'
      }

      let html = serializeNode(root, 0, 0)
      const truncated = html.length > MAX_RESULT_LENGTH
      if (truncated) {
        html = html.slice(0, MAX_RESULT_LENGTH) + '\n…(truncated)'
      }

      import.meta.hot.send('harness:query-dom-response', {
        requestId,
        html,
        element_count: elementCount,
        truncated,
      })
    } catch (err) {
      import.meta.hot.send('harness:query-dom-response', {
        requestId,
        html: '',
        element_count: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
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
