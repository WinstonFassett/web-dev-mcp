// Browser-side capnweb RPC target
// Exposes DOM access to the server via WebSocket RPC
//
// NOTE: This is a virtual module — must be valid JavaScript (no TS syntax).

import { RpcTarget, newWebSocketRpcSession } from 'capnweb'

// Global variables injected by gateway
// @ts-ignore — window.__WEB_DEV_MCP_SERVER__ set by gateway
// @ts-ignore — window.__html2canvas lazy-loaded for screenshots

// Generate or retrieve sticky browser ID
const BROWSER_ID_KEY = '__vite_live_dev_mcp_browser_id__'
function getBrowserId() {
  let id = sessionStorage.getItem(BROWSER_ID_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem(BROWSER_ID_KEY, id)
  }
  return id
}
const browserId = getBrowserId()

// Proxy-based wrapper that exposes any object over RPC
// Automatically wraps DOM nodes, arrays, and handles method binding
class AnyTarget extends RpcTarget {
  #target
  #wrapCache = new WeakMap()

  constructor(target) {
    super()
    this.#target = target
    return new Proxy(this, {
      get: (_, prop) => {
        // Prevent promise detection (thenable check)
        if (prop === 'then') return undefined
        // Expose RpcTarget internals
        if (prop === '__rpcTarget') return true

        const val = this.#target[prop]

        // Bind and wrap methods
        if (typeof val === 'function') {
          return (...args) => {
            const result = val.apply(this.#target, args)
            return this.#wrap(result)
          }
        }

        return this.#wrap(val)
      },
      set: (_, prop, value) => {
        this.#target[prop] = value
        // Dispatch events for form elements
        if ((prop === 'value' || prop === 'checked') && this.#target.dispatchEvent) {
          this.#target.dispatchEvent(new Event('input', { bubbles: true }))
          this.#target.dispatchEvent(new Event('change', { bubbles: true }))
        }
        return true
      }
    })
  }

  #wrap(val) {
    if (val === null || val === undefined) return val
    if (typeof val !== 'object' && typeof val !== 'function') return val

    // Already wrapped
    if (val.__rpcTarget) return val

    // Use cache to avoid creating multiple wrappers for same object
    if (this.#wrapCache.has(val)) return this.#wrapCache.get(val)

    // Wrap DOM nodes
    if (val instanceof Node) {
      const wrapped = new AnyTarget(val)
      this.#wrapCache.set(val, wrapped)
      return wrapped
    }

    // Wrap NodeList, HTMLCollection, and arrays containing nodes
    if (val instanceof NodeList || val instanceof HTMLCollection) {
      return Array.from(val).map(n => this.#wrap(n))
    }

    // Wrap Storage objects
    if (val instanceof Storage) {
      const wrapped = new AnyTarget(val)
      this.#wrapCache.set(val, wrapped)
      return wrapped
    }

    // Wrap Location
    if (val instanceof Location) {
      // Return plain object to avoid security issues with Location proxy
      return {
        href: val.href,
        protocol: val.protocol,
        host: val.host,
        hostname: val.hostname,
        port: val.port,
        pathname: val.pathname,
        search: val.search,
        hash: val.hash,
        origin: val.origin
      }
    }

    // Plain objects and arrays — return as-is (serialized over wire)
    if (Array.isArray(val) || val.constructor === Object) {
      return val
    }

    // DOMRect, etc — convert to plain object
    if (val instanceof DOMRect || val instanceof DOMRectReadOnly) {
      return { top: val.top, left: val.left, width: val.width, height: val.height, bottom: val.bottom, right: val.right }
    }

    // CSSStyleDeclaration — wrap it
    if (val instanceof CSSStyleDeclaration) {
      const wrapped = new AnyTarget(val)
      this.#wrapCache.set(val, wrapped)
      return wrapped
    }

    // Fallback: try to wrap, may fail for some exotic objects
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
  // Browser ID for CDP targeting
  get id() { return browserId }

  // Page info for CDP /json endpoint
  getPageInfo() {
    return {
      id: browserId,
      title: document.title,
      url: window.location.href,
      type: 'page',
    }
  }

  // Expose document and window directly via AnyTarget proxy
  get document() { return new AnyTarget(document) }
  get window() { return new AnyTarget(window) }
  get localStorage() { return new AnyTarget(localStorage) }
  get sessionStorage() { return new AnyTarget(sessionStorage) }

  // --- Browser interaction methods ---

  async screenshot(selector) {
    const target = selector ? document.querySelector(selector) : document.documentElement
    if (!target) return { error: 'Element not found: ' + selector }

    // Lazy-load html2canvas from CDN on first use
    if (!window.__html2canvas) {
      try {
        const mod = await import(/* @vite-ignore */ 'https://esm.sh/html2canvas@1.4.1')
        window.__html2canvas = mod.default || mod
      } catch (err) {
        return { error: 'Failed to load html2canvas: ' + err.message }
      }
    }

    try {
      const canvas = await window.__html2canvas(target, {
        useCORS: true,
        logging: false,
        scale: window.devicePixelRatio || 1,
      })
      return {
        data: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      }
    } catch (err) {
      return { error: 'Screenshot failed: ' + err.message }
    }
  }

  // Find element by CSS selector or text content
  // Prefix with "text=" to search by text: "text=Submit" or "text=60 comments"
  findElement(selector) {
    if (selector.startsWith('text=')) {
      var search = selector.slice(5)
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      var node
      while (node = walker.nextNode()) {
        var el = node
        // Check direct text content (not children's text)
        var directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join(' ')
        if (directText && directText.includes(search)) return el
      }
      // Fallback: any element containing the text
      walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes(search)) {
          // Prefer the most specific (deepest) match
          var children = node.querySelectorAll('*')
          for (var i = children.length - 1; i >= 0; i--) {
            if (children[i].textContent.trim().includes(search) &&
                children[i].children.length === 0) return children[i]
          }
          return node
        }
      }
      return null
    }
    return document.querySelector(selector)
  }

  click(selector) {
    var el = this.findElement(selector)
    if (!el) return { error: 'Element not found: ' + selector }
    el.click()
    return { clicked: selector, tag: el.tagName.toLowerCase() }
  }

  fill(selector, value) {
    var el = this.findElement(selector)
    if (!el) return { error: 'Element not found: ' + selector }
    // Use native setter to trigger React's synthetic event system
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
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

  selectOption(selector, value) {
    var el = this.findElement(selector)
    if (!el || el.tagName !== 'SELECT') return { error: 'Select element not found: ' + selector }
    // Find option by value or text
    const options = Array.from(el.options)
    const option = options.find(o => o.value === value) || options.find(o => o.textContent.trim() === value)
    if (!option) return { error: 'Option not found: ' + value }
    el.value = option.value
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { selected: selector, value: option.value, text: option.textContent.trim() }
  }

  hover(selector) {
    var el = this.findElement(selector)
    if (!el) return { error: 'Element not found: ' + selector }
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    return { hovered: selector }
  }

  pressKey(key, modifiers, selector) {
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
    target.dispatchEvent(new KeyboardEvent('keydown', opts))
    target.dispatchEvent(new KeyboardEvent('keypress', opts))
    target.dispatchEvent(new KeyboardEvent('keyup', opts))
    return { key, target: selector || 'activeElement' }
  }

  scroll(selector, x, y) {
    if (selector) {
      const el = document.querySelector(selector)
      if (!el) return { error: 'Element not found: ' + selector }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return { scrolledTo: selector }
    }
    window.scrollTo({ left: x || 0, top: y || 0, behavior: 'smooth' })
    return { scrolledTo: { x: x || 0, y: y || 0 } }
  }

  navigate(url) {
    window.location.href = url
    return { navigated: url }
  }

  getVisibleText(selector) {
    const el = selector ? document.querySelector(selector) : document.body
    if (!el) return { error: 'Element not found: ' + selector }
    return { text: el.innerText, length: el.innerText.length }
  }

  // Convert page DOM to markdown with links and structure
  getPageMarkdown(selector) {
    var root = selector ? document.querySelector(selector) : document.body
    if (!root) return { error: 'Element not found: ' + selector }

    var SKIP = new Set(['script', 'style', 'noscript', 'svg', 'link', 'meta', 'head'])
    var BLOCK = new Set(['div', 'p', 'section', 'article', 'main', 'header', 'footer', 'nav',
      'li', 'tr', 'td', 'th', 'blockquote', 'pre', 'figure', 'figcaption', 'details', 'summary'])

    function walk(node) {
      if (node.nodeType === 3) return node.textContent || ''
      if (node.nodeType !== 1) return ''
      var el = node
      var tag = el.tagName.toLowerCase()
      if (SKIP.has(tag)) return ''
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return ''
      var style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return ''

      var inner = ''
      for (var child of el.childNodes) inner += walk(child)
      inner = inner.replace(/\n{3,}/g, '\n\n')

      if (tag === 'a') {
        var href = el.getAttribute('href')
        var text = inner.trim()
        if (!text) return ''
        if (href) return '[' + text + '](' + href + ')'
        return text
      }
      if (tag === 'img') {
        var alt = el.getAttribute('alt') || ''
        var src = el.getAttribute('src') || ''
        return '![' + alt + '](' + src + ')'
      }
      if (tag === 'br') return '\n'
      if (tag === 'hr') return '\n---\n'
      if (/^h[1-6]$/.test(tag)) {
        var level = parseInt(tag[1])
        return '\n' + '#'.repeat(level) + ' ' + inner.trim() + '\n'
      }
      if (tag === 'li') {
        var parent = el.parentElement?.tagName.toLowerCase()
        var prefix = parent === 'ol' ? (Array.from(el.parentElement.children).indexOf(el) + 1) + '. ' : '- '
        return prefix + inner.trim() + '\n'
      }
      if (tag === 'pre' || tag === 'code') {
        if (tag === 'pre') return '\n```\n' + el.textContent + '\n```\n'
        return '`' + inner.trim() + '`'
      }
      if (tag === 'strong' || tag === 'b') return '**' + inner.trim() + '**'
      if (tag === 'em' || tag === 'i') return '*' + inner.trim() + '*'
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
        var desc = tag
        if (el.type) desc += '[' + el.type + ']'
        if (el.placeholder) desc += ' placeholder="' + el.placeholder + '"'
        if (el.value) desc += ' value="' + el.value + '"'
        if (el.id) desc += ' #' + el.id
        if (tag === 'button') desc += ': ' + inner.trim()
        return '<' + desc + '>'
      }
      if (BLOCK.has(tag)) return '\n' + inner + '\n'
      return inner
    }

    var md = walk(root).replace(/\n{3,}/g, '\n\n').trim()
    if (md.length > 30000) md = md.slice(0, 30000) + '\n\n...(truncated)'
    return { markdown: md, length: md.length }
  }

  // Keep eval for backward compat — serializes result to string
  eval(expression) {
    const fn = new Function('return (' + expression + ')')
    const raw = fn()
    if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
      return raw.then(v => typeof v === 'string' ? v : JSON.stringify(v))
    }
    return typeof raw === 'string' ? raw : JSON.stringify(raw)
  }

  // Keep queryDom for backward compat — returns serialized HTML snapshot
  queryDom(selector, options = {}) {
    const {
      max_depth = 3,
      attributes = ['id', 'class', 'href', 'src', 'value', 'type', 'placeholder', 'role', 'aria-label'],
      text_length = 100,
    } = options

    const root = selector ? document.querySelector(selector) : document.body
    if (!root) return { html: '', element_count: 0, truncated: false, error: 'No element found' }

    let elementCount = 0

    function serializeNode(node, depth, indent) {
      if (depth > max_depth) return '…'
      if (node.nodeType === 3) {
        const text = node.textContent.trim()
        if (!text) return ''
        return text.length > text_length ? text.slice(0, text_length) + '…' : text
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
          const displayVal = attr === 'class' && val.length > 80 ? val.slice(0, 80) + '…' : val
          attrs += ' ' + attr + '="' + displayVal.replace(/"/g, '&quot;') + '"'
        }
      }
      if (['br', 'hr', 'img', 'input'].includes(tag)) return pad + '<' + tag + attrs + '/>'

      const children = Array.from(el.childNodes)
      const childStrings = []
      for (const child of children) {
        const s = serializeNode(child, depth + 1, indent + 1)
        if (s) childStrings.push(s)
      }
      if (childStrings.length === 0) {
        const text = el.textContent?.trim() ?? ''
        const truncated = text.length > text_length ? text.slice(0, text_length) + '…' : text
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
    if (truncated) html = html.slice(0, 20480) + '\n…(truncated)'

    return { html, element_count: elementCount, truncated }
  }
}

// Connect to the RPC WebSocket
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
let rpcUrl = protocol + '//' + window.location.host + '/__rpc'

// If connected through gateway in hybrid mode, pass server ID
if (window.__WEB_DEV_MCP_SERVER__) {
  rpcUrl += '?server=' + encodeURIComponent(window.__WEB_DEV_MCP_SERVER__)
}

const browserApi = new BrowserApi()

try {
  newWebSocketRpcSession(rpcUrl, browserApi)
  console.log('[vite-live-dev-mcp] RPC connected:', rpcUrl)
} catch (err) {
  console.warn('[vite-live-dev-mcp] RPC connection failed:', err)
}
