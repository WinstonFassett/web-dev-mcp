// Browser-side capnweb RPC target
// Exposes DOM access to the server via WebSocket RPC
//
// NOTE: This is a virtual module — must be valid JavaScript (no TS syntax).

import { RpcTarget, newWebSocketRpcSession } from 'capnweb'

class DomElement extends RpcTarget {
  #el

  constructor(el) {
    super()
    this.#el = el
  }

  get textContent() { return this.#el.textContent }
  get innerHTML() { return this.#el.innerHTML }
  get outerHTML() { return this.#el.outerHTML }
  get tagName() { return this.#el.tagName }
  get id() { return this.#el.id }
  get className() { return this.#el.className }

  getAttribute(name) { return this.#el.getAttribute(name) }
  getBoundingClientRect() {
    const r = this.#el.getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
  }

  click() { this.#el.click() }
  focus() { this.#el.focus() }
  blur() { this.#el.blur() }

  setValue(value) {
    this.#el.value = value
    this.#el.dispatchEvent(new Event('input', { bubbles: true }))
    this.#el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  querySelector(selector) {
    const el = this.#el.querySelector(selector)
    return el ? new DomElement(el) : null
  }

  querySelectorAll(selector) {
    const els = this.#el.querySelectorAll(selector)
    return Array.from(els).map(el => new DomElement(el))
  }

  get childElementCount() { return this.#el.childElementCount }

  getChildren() {
    return Array.from(this.#el.children).map(el => new DomElement(el))
  }
}

class BrowserApi extends RpcTarget {
  eval(expression) {
    const fn = new Function('return (' + expression + ')')
    const raw = fn()
    // Serialize result
    if (raw && typeof raw === 'object' && typeof raw.then === 'function') {
      return raw.then(v => typeof v === 'string' ? v : JSON.stringify(v))
    }
    return typeof raw === 'string' ? raw : JSON.stringify(raw)
  }

  querySelector(selector) {
    const el = document.querySelector(selector)
    return el ? new DomElement(el) : null
  }

  querySelectorAll(selector) {
    const els = document.querySelectorAll(selector)
    return Array.from(els).map(el => new DomElement(el))
  }

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

  getTitle() { return document.title }
  getUrl() { return window.location.href }
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
