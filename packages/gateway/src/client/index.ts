// Browser client for web-dev-mcp gateway
// Injected into proxied HTML pages via <script src="/__client.js">
// Or loaded via Vite adapter with __WEB_DEV_MCP_ORIGIN__ set for cross-origin mode
//
// Patches console.*, error handlers, fetch/XHR
// Sends events to gateway via WebSocket, handles commands via JSON protocol

;(function() {
  if ((window as any).__WEB_DEV_MCP_LOADED__) return
  ;(window as any).__WEB_DEV_MCP_LOADED__ = true

  // Cross-origin support: when loaded via framework adapter, gateway is on a different origin
  const gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  const gatewayHost = gatewayOrigin.replace(/^https?:\/\//, '')
  const gatewayWsProtocol = gatewayOrigin.startsWith('https') ? 'wss:' : 'ws:'

  // Sticky browser ID (survives page reload within session)
  const BROWSER_ID_KEY = '__web_dev_mcp_browser_id__'
  let browserId = sessionStorage.getItem(BROWSER_ID_KEY)
  if (!browserId) {
    browserId = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem(BROWSER_ID_KEY, browserId)
  }

  // --- Events WebSocket (browser → server) ---
  let eventsWs: WebSocket | null = null
  let eventQueue: string[] = []
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const serverId = (window as any).__WEB_DEV_MCP_SERVER__ || null

  function connectEvents() {
    let url = gatewayWsProtocol + '//' + gatewayHost + '/__events'
    if (serverId) url += '?server=' + encodeURIComponent(serverId)
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
    const msg = JSON.stringify({ channel, payload, browserId })
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

  // --- Browser API (local, called by command handler) ---

  // Persistent state object — survives across eval calls within a session
  const state: Record<string, any> = {}

  // Find element by CSS selector or "text=..." for text content search
  function findElement(selector: string): HTMLElement | null {
    if (selector.startsWith('text=')) {
      const search = selector.slice(5)
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      let node: Node | null
      while (node = walker.nextNode()) {
        const el = node as HTMLElement
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => (n.textContent || '').trim())
          .join(' ')
        if (directText && directText.includes(search)) return el
      }
      const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      while (node = walker2.nextNode()) {
        if ((node as HTMLElement).textContent?.includes(search)) {
          const children = (node as HTMLElement).querySelectorAll('*')
          for (let i = children.length - 1; i >= 0; i--) {
            if (children[i].textContent?.trim().includes(search) &&
                children[i].children.length === 0) return children[i] as HTMLElement
          }
          return node as HTMLElement
        }
      }
      return null
    }
    return document.querySelector(selector) as HTMLElement | null
  }

  // Browser helper object — available in eval context as `browser`
  const browser = {
    eval(expression: string) {
      const fn = new Function('return (' + expression + ')')
      const raw = fn()
      if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
        return raw.then((v: any) => typeof v === 'string' ? v : JSON.stringify(v))
      }
      return typeof raw === 'string' ? raw : JSON.stringify(raw)
    },

    async elementSource(selector: string) {
      const el = findElement(selector)
      if (!el) return { error: 'Element not found: ' + selector }
      if (typeof (window as any).__resolveElementInfo !== 'function') return { error: 'element-source not installed' }
      try {
        const info = await (window as any).__resolveElementInfo(el)
        return info
      } catch (err: any) {
        return { error: err.message }
      }
    },

    markdown(selector?: string) {
      return commands.getPageMarkdown({ selector })
    },

    async screenshot(selectorOrOpts?: string | Record<string, any>) {
      return commands.screenshot(typeof selectorOrOpts === 'string' ? { selector: selectorOrOpts } : selectorOrOpts)
    },

    navigate(url: string) {
      return commands.navigate({ url })
    },

    click(selector: string) {
      return commands.click({ selector })
    },

    fill(selector: string, value: string) {
      return commands.fill({ selector, value })
    },

    async waitFor(selectorOrFn: string | Function, interval = 100, timeout = 5000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        try {
          let result
          if (typeof selectorOrFn === 'string') {
            result = document.querySelector(selectorOrFn)
          } else {
            result = selectorOrFn()
            if (result && typeof result.then === 'function') result = await result
          }
          if (result) return result
        } catch {}
        await new Promise(r => setTimeout(r, interval))
      }
      throw new Error(`waitFor timed out after ${timeout}ms`)
    },
  }

  // Command implementations — each method handles one command from the gateway
  const commands: Record<string, (params: any) => any> = {

    getPageInfo() {
      return { id: browserId, title: document.title, url: window.location.href, type: 'page' }
    },

    async eval(params: { code: string | string[] }) {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
      const globals = [document, window, localStorage, sessionStorage, state, browser]
      const globalNames = ['document', 'window', 'localStorage', 'sessionStorage', 'state', 'browser']

      function serialize(result: any): string {
        if (typeof result === 'string') return result
        if (result === undefined) return 'undefined'
        if (result === null) return 'null'
        if (result instanceof Node) {
          if (result instanceof HTMLElement) return result.outerHTML.slice(0, 2000)
          return result.textContent?.slice(0, 2000) ?? ''
        }
        return JSON.stringify(result, null, 2)
      }

      async function autoAwait(val: any): Promise<any> {
        if (val && typeof val === 'object' && typeof val.then === 'function') {
          return await val
        }
        return val
      }

      // Wait for DOM to settle: no mutations for `quiet` ms, with a max wait
      function waitForDomSettle(quiet = 150, maxWait = 3000): Promise<void> {
        return new Promise(resolve => {
          let timer: any = null
          const deadline = setTimeout(() => { cleanup(); resolve() }, maxWait)
          const observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => { cleanup(); resolve() }, quiet)
          })
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
          // If DOM is already quiet, resolve after `quiet` ms
          timer = setTimeout(() => { cleanup(); resolve() }, quiet)
          function cleanup() {
            observer.disconnect()
            clearTimeout(deadline)
            if (timer) clearTimeout(timer)
          }
        })
      }

      const steps = Array.isArray(params.code) ? params.code : [params.code]

      let result: any
      for (let i = 0; i < steps.length; i++) {
        const fn = new AsyncFunction(...globalNames, steps[i])
        result = await autoAwait(await fn(...globals))

        // Between steps (not after last): wait for DOM to settle
        // If result is null/undefined and next step exists, retry current step
        if (i < steps.length - 1) {
          await waitForDomSettle()
        }
      }

      return serialize(result)
    },

    queryDom(params: { selector?: string, max_depth?: number, attributes?: string[], text_length?: number }) {
      const { max_depth = 3, attributes = ['id', 'class', 'href', 'src', 'value', 'type', 'placeholder', 'role', 'aria-label'], text_length = 100 } = params
      const selector = params.selector || 'body'
      const root = document.querySelector(selector) ?? document.body
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
    },

    async screenshot(params: {
      selector?: string
      preset?: 'viewport' | 'element' | 'full' | 'thumb' | 'hd'
      format?: 'png' | 'jpeg'
      quality?: number
      scale?: number
      maxWidth?: number
    } = {}) {
      const selector = params.selector
      const target = selector ? document.querySelector(selector) : document.documentElement
      if (!target) return { error: 'Element not found: ' + selector }

      // Canvas element — use native toDataURL
      if (target instanceof HTMLCanvasElement) {
        try {
          const fmt = params.format === 'png' ? 'image/png' : 'image/jpeg'
          const data = target.toDataURL(fmt, params.quality ? params.quality / 100 : 0.8)
          return { data, width: target.width, height: target.height }
        } catch (err: any) {
          return { error: 'Canvas screenshot failed: ' + err.message }
        }
      }

      // Resolve preset defaults
      const preset = params.preset || (selector ? 'element' : 'viewport')
      const presets: Record<string, { scale: number; format: string; quality: number; maxWidth: number; fullPage: boolean }> = {
        viewport: { scale: 1, format: 'jpeg', quality: 80, maxWidth: 1024, fullPage: false },
        element:  { scale: 1, format: 'jpeg', quality: 80, maxWidth: 1024, fullPage: false },
        full:     { scale: 1, format: 'jpeg', quality: 80, maxWidth: 1024, fullPage: true },
        thumb:    { scale: 1, format: 'jpeg', quality: 60, maxWidth: 512,  fullPage: false },
        hd:       { scale: 1, format: 'png',  quality: 100, maxWidth: 1568, fullPage: false },
      }
      const p = presets[preset] || presets.viewport
      const format = params.format || p.format
      const quality = params.quality ?? p.quality
      const scale = params.scale ?? p.scale
      const maxWidth = params.maxWidth ?? p.maxWidth

      // Load modern-screenshot (lazy, cached)
      if (!(window as any).__modernScreenshot) {
        try {
          const libUrl = gatewayOrigin + '/__libs/modern-screenshot.js'
          const mod = await import(/* @vite-ignore */ libUrl).catch(() =>
            import(/* @vite-ignore */ 'https://esm.sh/modern-screenshot@4.6.8')
          )
          ;(window as any).__modernScreenshot = mod
        } catch (err: any) {
          return { error: 'Failed to load screenshot library: ' + err.message }
        }
      }

      try {
        const { domToPng, domToJpeg } = (window as any).__modernScreenshot
        const render = format === 'png' ? domToPng : domToJpeg

        const renderOpts: any = { scale, quality: quality / 100 }
        if (preset === 'viewport' || (preset !== 'full' && preset !== 'element')) {
          renderOpts.height = window.innerHeight
          renderOpts.style = { overflow: 'hidden' }
        }

        const dataUrl = await render(target, renderOpts)

        // Resize if wider than maxWidth
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Failed to decode screenshot'))
          img.src = dataUrl
        })

        if (img.naturalWidth > maxWidth) {
          const ratio = maxWidth / img.naturalWidth
          const w = Math.round(img.naturalWidth * ratio)
          const h = Math.round(img.naturalHeight * ratio)
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, w, h)
          const resized = canvas.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', quality / 100)
          return { data: resized, width: w, height: h }
        }

        return { data: dataUrl, width: img.naturalWidth, height: img.naturalHeight }
      } catch (err: any) {
        return { error: 'Screenshot failed: ' + err.message }
      }
    },

    click(params: { selector: string }) {
      const el = findElement(params.selector)
      if (!el) return { error: 'Element not found: ' + params.selector }
      el.click()
      return { clicked: params.selector, tag: el.tagName.toLowerCase() }
    },

    fill(params: { selector: string, value: string }) {
      const el = findElement(params.selector) as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) return { error: 'Element not found: ' + params.selector }
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, params.value)
      } else {
        el.value = params.value
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { filled: params.selector, value: params.value }
    },

    selectOption(params: { selector: string, value: string }) {
      const el = findElement(params.selector) as HTMLSelectElement | null
      if (!el || el.tagName !== 'SELECT') return { error: 'Select element not found: ' + params.selector }
      const options = Array.from(el.options)
      const option = options.find(o => o.value === params.value) || options.find(o => o.textContent?.trim() === params.value)
      if (!option) return { error: 'Option not found: ' + params.value }
      el.value = option.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return { selected: params.selector, value: option.value, text: option.textContent?.trim() || '' }
    },

    hover(params: { selector: string }) {
      const el = findElement(params.selector)
      if (!el) return { error: 'Element not found: ' + params.selector }
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      return { hovered: params.selector }
    },

    pressKey(params: { key: string, modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }, selector?: string }) {
      const target = params.selector ? document.querySelector(params.selector) : document.activeElement || document.body
      if (params.selector && !target) return { error: 'Element not found: ' + params.selector }
      const opts = {
        key: params.key,
        code: params.key.length === 1 ? 'Key' + params.key.toUpperCase() : params.key,
        bubbles: true,
        cancelable: true,
        ctrlKey: params.modifiers?.ctrl || false,
        shiftKey: params.modifiers?.shift || false,
        altKey: params.modifiers?.alt || false,
        metaKey: params.modifiers?.meta || false,
      }
      target!.dispatchEvent(new KeyboardEvent('keydown', opts))
      target!.dispatchEvent(new KeyboardEvent('keypress', opts))
      target!.dispatchEvent(new KeyboardEvent('keyup', opts))
      return { key: params.key, target: params.selector || 'activeElement' }
    },

    scroll(params: { selector?: string, x?: number, y?: number }) {
      if (params.selector) {
        const el = document.querySelector(params.selector)
        if (!el) return { error: 'Element not found: ' + params.selector }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return { scrolledTo: params.selector }
      }
      window.scrollTo({ left: params.x || 0, top: params.y || 0, behavior: 'smooth' })
      return { scrolledTo: { x: params.x || 0, y: params.y || 0 } }
    },

    navigate(params: { url: string }) {
      window.location.href = params.url
      return { navigated: params.url }
    },

    getVisibleText(params: { selector?: string }) {
      const el = params.selector ? document.querySelector(params.selector) : document.body
      if (!el) return { error: 'Element not found: ' + params.selector }
      return { text: (el as HTMLElement).innerText, length: (el as HTMLElement).innerText.length }
    },

    getPageMarkdown(params: { selector?: string }) {
      const root = params.selector ? document.querySelector(params.selector) : document.body
      if (!root) return { error: 'Element not found: ' + params.selector }

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
    },
  }

  // --- Command WebSocket (gateway → browser, browser → gateway) ---
  let cmdWs: WebSocket | null = null
  let cmdReconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectCmd() {
    let url = gatewayWsProtocol + '//' + gatewayHost + '/__rpc'
    if (serverId) url += '?server=' + encodeURIComponent(serverId)

    cmdWs = new WebSocket(url)

    cmdWs.onopen = () => {
      // Announce browser ID
      cmdWs!.send(JSON.stringify({ type: 'init', browserId }))
      originalConsole.log('[web-dev-mcp] Command channel connected')
    }

    cmdWs.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (!msg.id || !msg.method) return

        const handler = commands[msg.method]
        if (!handler) {
          cmdWs!.send(JSON.stringify({ id: msg.id, error: 'Unknown method: ' + msg.method }))
          return
        }

        try {
          const result = await handler(msg.params || {})
          cmdWs!.send(JSON.stringify({ id: msg.id, result }))
        } catch (err: any) {
          cmdWs!.send(JSON.stringify({ id: msg.id, error: err.message ?? String(err) }))
        }
      } catch {
        // Ignore malformed messages
      }
    }

    cmdWs.onclose = () => {
      cmdWs = null
      if (!cmdReconnectTimer) {
        cmdReconnectTimer = setTimeout(() => {
          cmdReconnectTimer = null
          connectCmd()
        }, 2000)
      }
    }

    cmdWs.onerror = () => {}
  }

  connectCmd()

  originalConsole.log('[web-dev-mcp] Client loaded')

  // Load element-grab overlay (lazy, on idle)
  const loadElementGrab = () => {
    const script = document.createElement('script')
    script.src = gatewayOrigin + '/__element-grab.js'
    script.async = true
    document.head.appendChild(script)
  }
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(loadElementGrab)
  } else {
    setTimeout(loadElementGrab, 1000)
  }
})()
