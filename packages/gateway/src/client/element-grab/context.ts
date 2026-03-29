/**
 * Element context resolution using bippy (React fiber) and element-source (multi-framework).
 * These are npm packages — do NOT hand-roll this logic.
 */
import {
  getFiberFromHostInstance,
  isInstrumentationActive,
  isCompositeFiber,
  getDisplayName,
  traverseFiber,
} from 'bippy'
import {
  resolveStack,
  formatStack,
  resolveComponentName,
} from 'element-source'
import { createElementSelector } from './utils/css-selector.js'
import { DEFAULT_MAX_CONTEXT_LINES, PREVIEW_TEXT_MAX_LENGTH, PREVIEW_ATTR_VALUE_MAX_LENGTH } from './constants.js'

// --- Next.js / React internal component names to skip ---
const INTERNAL_NAMES = new Set([
  'InnerLayoutRouter', 'RedirectErrorBoundary', 'RedirectBoundary',
  'HTTPAccessFallbackErrorBoundary', 'HTTPAccessFallbackBoundary',
  'LoadingBoundary', 'ErrorBoundary', 'InnerScrollAndFocusHandler',
  'ScrollAndFocusHandler', 'RenderFromTemplateContext', 'OuterLayoutRouter',
  'body', 'html', 'DevRootHTTPAccessFallbackBoundary',
  'AppDevOverlayErrorBoundary', 'AppDevOverlay', 'HotReload', 'Router',
  'ErrorBoundaryHandler', 'AppRouter', 'ServerRoot', 'SegmentStateProvider',
  'RootErrorBoundary', 'LoadableComponent', 'MotionDOMComponent',
  'Suspense', 'Fragment', 'StrictMode', 'Profiler', 'SuspenseList',
])

const NON_COMPONENT_PREFIXES = ['_', '$', 'motion.', 'styled.', 'chakra.', 'ark.', 'Primitive.', 'Slot.']

const isUsefulName = (name: string): boolean => {
  if (!name || INTERNAL_NAMES.has(name)) return false
  if (name === 'SlotClone' || name === 'Slot') return false
  for (const prefix of NON_COMPONENT_PREFIXES) {
    if (name.startsWith(prefix)) return false
  }
  return true
}

// --- Find nearest fiber-attached element ---
export const findNearestFiberElement = (element: Element): Element => {
  if (!isInstrumentationActive()) return element
  let cur: Element | null = element
  while (cur) {
    if (getFiberFromHostInstance(cur)) return cur
    cur = cur.parentElement
  }
  return element
}

// --- Get component display name for an element ---
export const getComponentDisplayName = (element: Element): string | null => {
  if (!isInstrumentationActive()) return null
  const resolved = findNearestFiberElement(element)
  const fiber = getFiberFromHostInstance(resolved)
  if (!fiber) return null

  let cur = fiber.return
  while (cur) {
    if (isCompositeFiber(cur)) {
      const name = getDisplayName(cur.type)
      if (name && isUsefulName(name)) return name
    }
    cur = cur.return
  }
  return null
}

// --- Get component names from fiber chain ---
const getComponentNamesFromFiber = (element: Element, maxCount: number): string[] => {
  if (!isInstrumentationActive()) return []
  const fiber = getFiberFromHostInstance(element)
  if (!fiber) return []

  const names: string[] = []
  traverseFiber(fiber, (cur) => {
    if (names.length >= maxCount) return true
    if (isCompositeFiber(cur)) {
      const name = getDisplayName(cur.type)
      if (name && isUsefulName(name)) names.push(name)
    }
    return false
  }, true) // ascending
  return names
}

// --- Get stack context (source locations) ---
export const getStackContext = async (element: Element, maxLines = DEFAULT_MAX_CONTEXT_LINES): Promise<string> => {
  const stack = await resolveStack(element)
  if (stack.length > 0) return formatStack(stack, maxLines)

  const names = getComponentNamesFromFiber(element, maxLines)
  if (names.length > 0) return names.map(n => `\n  in ${n}`).join('')

  return ''
}

// --- Truncate helper ---
const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '…' : s

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
  const resolved = findNearestFiberElement(element)
  const html = getHTMLPreview(resolved)
  const stack = await getStackContext(resolved)
  const component = getComponentDisplayName(resolved)
  const selector = createElementSelector(resolved)

  // Try to get source info from element-source
  let source: ElementContext['source'] | undefined
  try {
    const stackFrames = await resolveStack(resolved)
    if (stackFrames.length > 0) {
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
