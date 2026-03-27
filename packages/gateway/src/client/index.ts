// Browser client for web-dev-mcp gateway
// Injected into proxied HTML pages via <script src="/__client.js">
// Or loaded via Vite adapter with __WEB_DEV_MCP_ORIGIN__ set for cross-origin mode
//
// Patches console.*, error handlers, fetch/XHR
// Sends events to gateway via WebSocket, connects RPC for eval/queryDom

;(function() {
  if ((window as any).__WEB_DEV_MCP_LOADED__) return
  ;(window as any).__WEB_DEV_MCP_LOADED__ = true

  // Cross-origin support: when loaded via framework adapter, gateway is on a different origin
  const gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  const gatewayHost = gatewayOrigin.replace(/^https?:\/\//, '')
  const gatewayWsProtocol = gatewayOrigin.startsWith('https') ? 'wss:' : 'ws:'

  // --- Events WebSocket (browser → server) ---
  let eventsWs: WebSocket | null = null
  let eventQueue: string[] = []
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectEvents() {
    const url = gatewayWsProtocol + '//' + gatewayHost + '/__events'
    eventsWs = new WebSocket(url)

    eventsWs.onopen = () => {
      for (const msg of eventQueue) {
        eventsWs!.send(msg)
      }
      eventQueue = []
    }

    eventsWs.onclose = () => {
      eventsWs = null
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connectEvents()
        }, 2000)
      }
    }

    eventsWs.onerror = () => {}
  }

  function sendEvent(channel: string, payload: any) {
    const msg = JSON.stringify({ channel, payload })
    if (eventsWs && eventsWs.readyState === WebSocket.OPEN) {
      eventsWs.send(msg)
    } else {
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
      (originalConsole as any)[level](...args)

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

  // --- React DevTools (bippy) — opt-in via __WEB_DEV_MCP_REACT__ flag ---
  let reactTreeGetter: ((opts: any) => any) | null = null

  if ((window as any).__WEB_DEV_MCP_REACT__) {
    import('bippy').then(({ instrument, traverseFiber, getDisplayName, isCompositeFiber, traverseProps, traverseState }) => {
      let fiberRoot: any = null

      instrument({
        onCommitFiberRoot(_rendererID: any, root: any) {
          fiberRoot = root
        },
      })

      function truncateValue(val: any, maxLen = 200) {
        try {
          const s = typeof val === 'string' ? val : JSON.stringify(val)
          return s && s.length > maxLen ? s.slice(0, maxLen) + '\u2026' : (s ?? 'undefined')
        } catch {
          return String(val)
        }
      }

      reactTreeGetter = (request: any) => {
        const maxDepth = Math.min(request.depth ?? 8, 20)

        if (!fiberRoot) {
          return { snapshot_at: Date.now(), total_components: 0, tree: [] }
        }

        const nodes: any[] = []
        traverseFiber(fiberRoot, (f: any) => {
          if (!isCompositeFiber(f)) return

          const name = getDisplayName(f) ?? 'Anonymous'
          if (request.filter_name && !name.toLowerCase().includes(request.filter_name.toLowerCase())) return

          const node: any = { name, children: [] }

          if (request.include_props !== false) {
            const props: any = {}
            traverseProps(f, (propName: string, nextValue: any) => {
              if (propName !== 'children') props[propName] = truncateValue(nextValue)
            })
            if (Object.keys(props).length > 0) node.props = props
          }

          if (request.include_state) {
            const state: any = {}
            let stateIdx = 0
            traverseState(f, (nextValue: any) => {
              state[`state_${stateIdx++}`] = truncateValue(nextValue)
            })
            if (Object.keys(state).length > 0) node.state = state
          }

          nodes.push(node)
        })

        return { snapshot_at: Date.now(), total_components: nodes.length, tree: nodes }
      }

      originalConsole.log('[web-dev-mcp] React DevTools (bippy) initialized')
    }).catch(() => {
      originalConsole.warn('[web-dev-mcp] bippy not available — install bippy for React DevTools')
    })
  }

  // --- capnweb RPC (for eval/queryDom/getReactTree from server) ---
  import('capnweb').then(({ RpcTarget, newWebSocketRpcSession }) => {
    // @ts-ignore
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

        getReactTree(opts: any) {
          if (reactTreeGetter) return reactTreeGetter(opts)
          return { error: 'React DevTools not enabled. Start gateway with --react flag.' }
        }

        // --- Browser interaction methods ---

        async screenshot(selector?: string) {
          const target = selector ? document.querySelector(selector) : document.documentElement
          if (!target) return { error: 'Element not found: ' + selector }

          if (!(window as any).__html2canvas) {
            try {
              const mod = await import(/* @vite-ignore */ 'https://esm.sh/html2canvas@1.4.1')
              ;(window as any).__html2canvas = mod.default || mod
            } catch (err: any) {
              return { error: 'Failed to load html2canvas: ' + err.message }
            }
          }

          try {
            const canvas = await (window as any).__html2canvas(target, {
              useCORS: true,
              logging: false,
              scale: window.devicePixelRatio || 1,
            })
            return {
              data: canvas.toDataURL('image/png'),
              width: canvas.width,
              height: canvas.height,
            }
          } catch (err: any) {
            return { error: 'Screenshot failed: ' + err.message }
          }
        }

        click(selector: string) {
          const el = document.querySelector(selector) as HTMLElement | null
          if (!el) return { error: 'Element not found: ' + selector }
          el.click()
          return { clicked: selector, tag: el.tagName.toLowerCase() }
        }

        fill(selector: string, value: string) {
          const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null
          if (!el) return { error: 'Element not found: ' + selector }
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, value)
          } else {
            el.value = value
          }
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return { filled: selector, value }
        }

        selectOption(selector: string, value: string) {
          const el = document.querySelector(selector) as HTMLSelectElement | null
          if (!el || el.tagName !== 'SELECT') return { error: 'Select element not found: ' + selector }
          const options = Array.from(el.options)
          const option = options.find(o => o.value === value) || options.find(o => o.textContent?.trim() === value)
          if (!option) return { error: 'Option not found: ' + value }
          el.value = option.value
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return { selected: selector, value: option.value, text: option.textContent?.trim() || '' }
        }

        hover(selector: string) {
          const el = document.querySelector(selector)
          if (!el) return { error: 'Element not found: ' + selector }
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
          return { hovered: selector }
        }

        pressKey(key: string, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }, selector?: string) {
          const target = selector ? document.querySelector(selector) : document.activeElement || document.body
          if (selector && !target) return { error: 'Element not found: ' + selector }
          const opts = {
            key,
            code: key.length === 1 ? 'Key' + key.toUpperCase() : key,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers?.ctrl || false,
            shiftKey: modifiers?.shift || false,
            altKey: modifiers?.alt || false,
            metaKey: modifiers?.meta || false,
          }
          target!.dispatchEvent(new KeyboardEvent('keydown', opts))
          target!.dispatchEvent(new KeyboardEvent('keypress', opts))
          target!.dispatchEvent(new KeyboardEvent('keyup', opts))
          return { key, target: selector || 'activeElement' }
        }

        scroll(selector?: string, x?: number, y?: number) {
          if (selector) {
            const el = document.querySelector(selector)
            if (!el) return { error: 'Element not found: ' + selector }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            return { scrolledTo: selector }
          }
          window.scrollTo({ left: x || 0, top: y || 0, behavior: 'smooth' })
          return { scrolledTo: { x: x || 0, y: y || 0 } }
        }

        getVisibleText(selector?: string) {
          const el = selector ? document.querySelector(selector) : document.body
          if (!el) return { error: 'Element not found: ' + selector }
          return { text: (el as HTMLElement).innerText, length: (el as HTMLElement).innerText.length }
        }

        getPageMarkdown(selector?: string) {
          const root = selector ? document.querySelector(selector) : document.body
          if (!root) return { error: 'Element not found: ' + selector }

          const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'link', 'meta', 'head'])
          const BLOCK = new Set(['div', 'p', 'section', 'article', 'main', 'header', 'footer', 'nav',
            'li', 'tr', 'td', 'th', 'blockquote', 'pre', 'figure', 'figcaption', 'details', 'summary'])

          function walk(node: Node): string {
            if (node.nodeType === 3) return node.textContent || ''
            if (node.nodeType !== 1) return ''
            const el = node as HTMLElement
            const tag = el.tagName.toLowerCase()
            if (SKIP.has(tag)) return ''
            if (el.hidden || el.getAttribute('aria-hidden') === 'true') return ''
            const style = window.getComputedStyle(el)
            if (style.display === 'none' || style.visibility === 'hidden') return ''

            let inner = ''
            for (const child of el.childNodes) inner += walk(child)
            inner = inner.replace(/\n{3,}/g, '\n\n')

            if (tag === 'a') {
              const href = el.getAttribute('href')
              const text = inner.trim()
              if (!text) return ''
              if (href) return '[' + text + '](' + href + ')'
              return text
            }
            if (tag === 'img') return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')'
            if (tag === 'br') return '\n'
            if (tag === 'hr') return '\n---\n'
            if (/^h[1-6]$/.test(tag)) return '\n' + '#'.repeat(parseInt(tag[1])) + ' ' + inner.trim() + '\n'
            if (tag === 'li') {
              const parent = el.parentElement?.tagName.toLowerCase()
              const prefix = parent === 'ol' ? (Array.from(el.parentElement!.children).indexOf(el) + 1) + '. ' : '- '
              return prefix + inner.trim() + '\n'
            }
            if (tag === 'pre') return '\n```\n' + el.textContent + '\n```\n'
            if (tag === 'code') return '`' + inner.trim() + '`'
            if (tag === 'strong' || tag === 'b') return '**' + inner.trim() + '**'
            if (tag === 'em' || tag === 'i') return '*' + inner.trim() + '*'
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
              let desc = tag
              if ((el as HTMLInputElement).type) desc += '[' + (el as HTMLInputElement).type + ']'
              if ((el as HTMLInputElement).placeholder) desc += ' placeholder="' + (el as HTMLInputElement).placeholder + '"'
              if ((el as HTMLInputElement).value) desc += ' value="' + (el as HTMLInputElement).value + '"'
              if (el.id) desc += ' #' + el.id
              if (tag === 'button') desc += ': ' + inner.trim()
              return '<' + desc + '>'
            }
            if (BLOCK.has(tag)) return '\n' + inner + '\n'
            return inner
          }

          let md = walk(root).replace(/\n{3,}/g, '\n\n').trim()
          if (md.length > 30000) md = md.slice(0, 30000) + '\n\n...(truncated)'
          return { markdown: md, length: md.length }
        }
      }

      // Connect RPC to gateway (may be cross-origin)
      let rpcUrl = gatewayWsProtocol + '//' + gatewayHost + '/__rpc'

      // In hybrid mode, pass server ID so gateway knows which project this browser belongs to
      if ((window as any).__WEB_DEV_MCP_SERVER__) {
        rpcUrl += '?server=' + encodeURIComponent((window as any).__WEB_DEV_MCP_SERVER__)
      }

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
