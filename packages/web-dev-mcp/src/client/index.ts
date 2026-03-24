// Browser client for web-dev-mcp gateway
// Injected into proxied HTML pages via <script src="/__client.js">
// Patches console.*, error handlers, optionally fetch/XHR
// Sends events to gateway via WebSocket, connects RPC for eval/queryDom

;(function() {
  // Prevent double-initialization
  if ((window as any).__WEB_DEV_MCP_LOADED__) return
  ;(window as any).__WEB_DEV_MCP_LOADED__ = true

  const gatewayOrigin = window.location.origin

  // --- Events WebSocket (browser → server) ---
  let eventsWs: WebSocket | null = null
  let eventQueue: string[] = []
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectEvents() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = protocol + '//' + window.location.host + '/__events'
    eventsWs = new WebSocket(url)

    eventsWs.onopen = () => {
      // Flush queued events
      for (const msg of eventQueue) {
        eventsWs!.send(msg)
      }
      eventQueue = []
    }

    eventsWs.onclose = () => {
      eventsWs = null
      // Reconnect after 2s
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectEvents()
        }, 2000)
      }
    }

    eventsWs.onerror = () => {
      // Will trigger onclose
    }
  }

  function sendEvent(channel: string, payload: any) {
    const msg = JSON.stringify({ channel, payload })
    if (eventsWs && eventsWs.readyState === WebSocket.OPEN) {
      eventsWs.send(msg)
    } else {
      // Queue if not connected yet
      if (eventQueue.length < 1000) {
        eventQueue.push(msg)
      }
    }
  }

  connectEvents()

  // --- Console patching ---
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  }

  const LEVELS = ['log', 'warn', 'error', 'info', 'debug'] as const

  for (const level of LEVELS) {
    (console as any)[level] = (...args: any[]) => {
      // Call original first
      (originalConsole as any)[level](...args)

      // Serialize args, truncate each at 2000 chars
      const serializedArgs = args.map((arg: any) => {
        try {
          const s = typeof arg === 'string' ? arg : JSON.stringify(arg)
          return s && s.length > 2000 ? s.slice(0, 2000) + '\u2026' : (s ?? String(arg))
        } catch {
          return String(arg)
        }
      })

      const payload: any = { level, args: serializedArgs }

      if (level === 'error' && args[0] instanceof Error) {
        payload.stack = args[0].stack
      }

      sendEvent('console', payload)

      if (level === 'error') {
        sendEvent('error', {
          type: 'console-error',
          message: serializedArgs.join(' '),
          stack: payload.stack,
        })
      }
    }
  }

  // --- Unhandled exception handler ---
  window.addEventListener('error', (event) => {
    sendEvent('error', {
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
    sendEvent('error', {
      type: 'unhandled-rejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  // --- Network patching ---
  const EXCLUDE_PATTERNS = ['/__', '/@', '/node_modules']

  function shouldExclude(url: string) {
    return EXCLUDE_PATTERNS.some(p => url.includes(p))
  }

  // Patch fetch
  const originalFetch = window.fetch.bind(window)
  window.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (shouldExclude(url)) return originalFetch(input, init)

    const start = performance.now()
    const response = await originalFetch(input, init)
    const duration = Math.round(performance.now() - start)

    sendEvent('network', {
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
  XMLHttpRequest.prototype.open = function(method: string, url: any, ...rest: any[]) {
    (this as any).__harness_method = method
    ;(this as any).__harness_url = typeof url === 'string' ? url : url.href
    return (XHROpen as any).call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.send = function(body?: any) {
    const url = (this as any).__harness_url
    if (shouldExclude(url)) return XHRSend.call(this, body)

    const start = performance.now()
    this.addEventListener('loadend', () => {
      sendEvent('network', {
        method: ((this as any).__harness_method ?? 'GET').toUpperCase(),
        url,
        status: this.status,
        duration: Math.round(performance.now() - start),
        initiator: 'xhr',
      })
    })
    return XHRSend.call(this, body)
  }

  // --- capnweb RPC (for eval/queryDom from server) ---
  import('capnweb').then(({ RpcTarget, newWebSocketRpcSession }) => {
    // @ts-ignore - chobitsu import
    import('chobitsu').then((chobitsuModule) => {
      const chobitsu = chobitsuModule.default || chobitsuModule

      const BROWSER_ID_KEY = '__web_dev_mcp_browser_id__'
      function getBrowserId() {
        let id = sessionStorage.getItem(BROWSER_ID_KEY)
        if (!id) {
          id = Math.random().toString(36).slice(2) + Date.now().toString(36)
          sessionStorage.setItem(BROWSER_ID_KEY, id)
        }
        return id
      }
      const browserId = getBrowserId()

      // Proxy-based wrapper for DOM objects
      class AnyTarget extends RpcTarget {
        #target: any
        #wrapCache = new WeakMap()

        constructor(target: any) {
          super()
          this.#target = target
          return new Proxy(this, {
            get: (_: any, prop: string) => {
              if (prop === 'then') return undefined
              if (prop === '__rpcTarget') return true

              const val = this.#target[prop]

              if (typeof val === 'function') {
                return (...args: any[]) => {
                  const result = val.apply(this.#target, args)
                  return this.#wrap(result)
                }
              }

              return this.#wrap(val)
            },
            set: (_: any, prop: string, value: any) => {
              this.#target[prop] = value
              if ((prop === 'value' || prop === 'checked') && this.#target.dispatchEvent) {
                this.#target.dispatchEvent(new Event('input', { bubbles: true }))
                this.#target.dispatchEvent(new Event('change', { bubbles: true }))
              }
              return true
            }
          })
        }

        #wrap(val: any): any {
          if (val === null || val === undefined) return val
          if (typeof val !== 'object' && typeof val !== 'function') return val
          if (val.__rpcTarget) return val
          if (this.#wrapCache.has(val)) return this.#wrapCache.get(val)

          if (val instanceof Node) {
            const wrapped = new AnyTarget(val)
            this.#wrapCache.set(val, wrapped)
            return wrapped
          }
          if (val instanceof NodeList || val instanceof HTMLCollection) {
            return Array.from(val).map(n => this.#wrap(n))
          }
          if (val instanceof Storage) {
            const wrapped = new AnyTarget(val)
            this.#wrapCache.set(val, wrapped)
            return wrapped
          }
          if (val instanceof Location) {
            return { href: val.href, protocol: val.protocol, host: val.host, hostname: val.hostname, port: val.port, pathname: val.pathname, search: val.search, hash: val.hash, origin: val.origin }
          }
          if (Array.isArray(val) || val.constructor === Object) return val
          if (val instanceof DOMRect || val instanceof DOMRectReadOnly) {
            return { top: val.top, left: val.left, width: val.width, height: val.height, bottom: val.bottom, right: val.right }
          }
          if (val instanceof CSSStyleDeclaration) {
            const wrapped = new AnyTarget(val)
            this.#wrapCache.set(val, wrapped)
            return wrapped
          }

          try {
            const wrapped = new AnyTarget(val)
            this.#wrapCache.set(val, wrapped)
            return wrapped
          } catch {
            return String(val)
          }
        }
      }

      class BrowserApi extends RpcTarget {
        get id() { return browserId }

        getPageInfo() {
          return { id: browserId, title: document.title, url: window.location.href, type: 'page' }
        }

        #cdpCallback: any = null

        cdpConnect(callback: any) {
          this.#cdpCallback = callback
          chobitsu.setOnMessage((message: string) => {
            if (this.#cdpCallback) this.#cdpCallback.send(message)
          })
          return true
        }

        cdpSend(message: string) {
          chobitsu.sendRawMessage(message)
        }

        cdpDisconnect() {
          this.#cdpCallback = null
          chobitsu.setOnMessage(() => {})
        }

        get document() { return new AnyTarget(document) }
        get window() { return new AnyTarget(window) }
        get localStorage() { return new AnyTarget(localStorage) }
        get sessionStorage() { return new AnyTarget(sessionStorage) }

        eval(expression: string) {
          const fn = new Function('return (' + expression + ')')
          const raw = fn()
          if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
            return raw.then((v: any) => typeof v === 'string' ? v : JSON.stringify(v))
          }
          return typeof raw === 'string' ? raw : JSON.stringify(raw)
        }

        queryDom(selector: string, options: any = {}) {
          const { max_depth = 3, attributes = ['id', 'class', 'href', 'src', 'value', 'type', 'placeholder', 'role', 'aria-label'], text_length = 100 } = options

          const root = selector ? document.querySelector(selector) : document.body
          if (!root) return { html: '', element_count: 0, truncated: false, error: 'No element found' }

          let elementCount = 0

          function serializeNode(node: any, depth: number, indent: number): string {
            if (depth > max_depth) return '\u2026'
            if (node.nodeType === 3) {
              const text = node.textContent.trim()
              if (!text) return ''
              return text.length > text_length ? text.slice(0, text_length) + '\u2026' : text
            }
            if (node.nodeType !== 1) return ''

            const el = node
            const tag = el.tagName.toLowerCase()
            if (['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(tag)) return ''

            elementCount++
            const pad = '  '.repeat(indent)
            let attrs = ''
            for (const attr of attributes) {
              const val = el.getAttribute(attr)
              if (val !== null && val !== '') {
                const displayVal = attr === 'class' && val.length > 80 ? val.slice(0, 80) + '\u2026' : val
                attrs += ' ' + attr + '="' + displayVal.replace(/"/g, '&quot;') + '"'
              }
            }
            if (['br', 'hr', 'img', 'input'].includes(tag)) return pad + '<' + tag + attrs + '/>'

            const children = Array.from(el.childNodes)
            const childStrings: string[] = []
            for (const child of children) {
              const s = serializeNode(child, depth + 1, indent + 1)
              if (s) childStrings.push(s)
            }
            if (childStrings.length === 0) {
              const text = el.textContent?.trim() ?? ''
              const truncated = text.length > text_length ? text.slice(0, text_length) + '\u2026' : text
              if (truncated) return pad + '<' + tag + attrs + '>' + truncated + '</' + tag + '>'
              return pad + '<' + tag + attrs + '/>'
            }
            if (childStrings.length === 1 && !childStrings[0].includes('\n') && childStrings[0].length < 80) {
              return pad + '<' + tag + attrs + '>' + childStrings[0].trim() + '</' + tag + '>'
            }
            return pad + '<' + tag + attrs + '>\n' + childStrings.join('\n') + '\n' + pad + '</' + tag + '>'
          }

          let html = serializeNode(root, 0, 0)
          const truncated = html.length > 20480
          if (truncated) html = html.slice(0, 20480) + '\n\u2026(truncated)'

          return { html, element_count: elementCount, truncated }
        }
      }

      // Connect RPC
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const rpcUrl = protocol + '//' + window.location.host + '/__rpc'
      const browserApi = new BrowserApi()

      try {
        newWebSocketRpcSession(rpcUrl, browserApi)
        originalConsole.log('[web-dev-mcp] RPC connected:', rpcUrl)
      } catch (err) {
        originalConsole.warn('[web-dev-mcp] RPC connection failed:', err)
      }
    })
  }).catch((err: any) => {
    originalConsole.warn('[web-dev-mcp] Could not load RPC modules:', err)
  })

  originalConsole.log('[web-dev-mcp] Client loaded')
})()
