// Browser-side capnweb RPC target
// Exposes DOM access to the server via WebSocket RPC
//
// NOTE: This is a virtual module — must be valid JavaScript (no TS syntax).

import { RpcTarget, newWebSocketRpcSession } from 'capnweb'

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
  // Expose document and window directly via AnyTarget proxy
  get document() { return new AnyTarget(document) }
  get window() { return new AnyTarget(window) }
  get localStorage() { return new AnyTarget(localStorage) }
  get sessionStorage() { return new AnyTarget(sessionStorage) }

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
const rpcUrl = protocol + '//' + window.location.host + '/__rpc'
const browserApi = new BrowserApi()

try {
  newWebSocketRpcSession(rpcUrl, browserApi)
  console.log('[vite-live-dev-mcp] RPC connected:', rpcUrl)
} catch (err) {
  console.warn('[vite-live-dev-mcp] RPC connection failed:', err)
}
