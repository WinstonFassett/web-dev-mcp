/**
 * Element context resolution using element-source (multi-framework).
 * element-source handles React, Vue, Svelte, Solid — component names + source locations.
 * Loaded lazily on first grab to keep initial bundle small.
 */
import { createElementSelector } from './utils/css-selector.js'
import { PREVIEW_TEXT_MAX_LENGTH, PREVIEW_ATTR_VALUE_MAX_LENGTH } from './constants.js'

// --- Lazy-loaded element-source module ---
let elementSourceModule: any = null
let loadPromise: Promise<any> | null = null

const loadElementSource = async () => {
  if (elementSourceModule) return elementSourceModule
  if (loadPromise) return loadPromise
  const gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  const libUrl = gatewayOrigin + '/__libs/element-source.js'
  loadPromise = import(/* @vite-ignore */ libUrl).catch(() =>
    // Fallback: try bundled import
    import('element-source')
  ).then(mod => {
    elementSourceModule = mod
    return mod
  }).catch(err => {
    console.warn('[element-grab] Could not load element-source:', err)
    return null
  })
  return loadPromise
}

// --- Truncate helper ---
const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '…' : s

// --- Get component display name (sync — uses cached module) ---
export const getComponentDisplayName = (element: Element): string | null => {
  if (!elementSourceModule?.resolveComponentName) return null
  // resolveComponentName is async but we need sync for hover labels.
  // Fire-and-forget: start the resolution, return null for now.
  // The next hover tick will have the cached result.
  // For sync access, try the React fiber directly.
  try {
    const fiberKey = Object.keys(element).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    if (fiberKey) {
      const fiber = (element as any)[fiberKey]
      let cur = fiber?.return
      while (cur) {
        const name = cur.type?.displayName || cur.type?.name
        if (name && typeof cur.type === 'function' && name.length > 1 && name[0] === name[0].toUpperCase()) return name
        cur = cur.return
      }
    }
  } catch {}
  return null
}

// --- Get HTML preview (compact) ---
export const getHTMLPreview = (element: Element): string => {
  const tag = element.tagName.toLowerCase()
  const text = element instanceof HTMLElement
    ? (element.innerText?.trim() ?? element.textContent?.trim() ?? '')
    : (element.textContent?.trim() ?? '')

  let attrs = ''
  for (const { name, value } of element.attributes) {
    attrs += ` ${name}="${truncate(value, PREVIEW_ATTR_VALUE_MAX_LENGTH)}"`
  }

  const truncatedText = truncate(text, PREVIEW_TEXT_MAX_LENGTH)
  if (truncatedText.length > 0) {
    return `<${tag}${attrs}>\n  ${truncatedText}\n</${tag}>`
  }
  return `<${tag}${attrs} />`
}

// --- Build full element context ---
export interface ElementContext {
  html: string
  stack: string
  component: string | null
  selector: string
  source?: { file: string; line?: number; column?: number }
}

export const getElementContext = async (element: Element): Promise<ElementContext> => {
  const mod = await loadElementSource()

  const html = getHTMLPreview(element)
  const selector = createElementSelector(element)

  let component: string | null = null
  let stack = ''
  let source: ElementContext['source'] | undefined

  if (mod) {
    // Get component name
    try {
      component = await mod.resolveComponentName(element)
    } catch {}

    // Get stack context (source locations + component chain)
    try {
      const stackFrames = await mod.resolveStack(element)
      if (stackFrames.length > 0) {
        stack = mod.formatStack(stackFrames, 3)
        const frame = stackFrames[0] as any
        if (frame.fileName || frame.filePath) {
          source = {
            file: frame.fileName || frame.filePath,
            line: frame.lineNumber,
            column: frame.columnNumber,
          }
        }
      }
    } catch {}
  }

  return { html, stack, component, selector, source }
}

// --- Format context as compact card ---
export const formatContextCard = (ctx: ElementContext): string => {
  const lines: string[] = []

  // Header: <ComponentName> (tag) or just <tag>
  if (ctx.component) {
    lines.push(`<${ctx.component}> (${ctx.html.match(/^<(\w+)/)?.[1] ?? '?'})`)
  } else {
    lines.push(ctx.html.split('\n')[0])
  }

  // Source file
  if (ctx.source?.file) {
    let loc = ctx.source.file
    if (ctx.source.line) loc += `:${ctx.source.line}`
    if (ctx.source.column) loc += `:${ctx.source.column}`
    lines.push(`src: ${loc}`)
  }

  // Stack context (component chain)
  if (ctx.stack) lines.push(ctx.stack.trim())

  // Selector
  lines.push(`sel: ${ctx.selector}`)

  // Live ref hint
  lines.push(`Live ref: window.__LAST_GRABBED__.element`)

  return lines.join('\n')
}
