/**
 * element-grab: framework-agnostic UI element selection with MCP relay.
 * Vanilla TS — no framework runtime. Uses element-source (lazy-loaded) for
 * component names and source resolution.
 */
import { mountRoot } from './utils/mount-root.js'
import { OverlayCanvas } from './overlay-canvas.js'
import type { OverlayBounds } from './overlay-canvas.js'
import { getElementContext, formatContextCard, getComponentDisplayName } from './context.js'
import {
  ELEMENT_DETECTION_THROTTLE_MS, ACTIVATION_KEY, REQUIRE_SHIFT,
  FROZEN_GLOW_COLOR, FROZEN_GLOW_EDGE_PX, Z_INDEX_OVERLAY_CANVAS,
  FADE_DURATION_MS, FEEDBACK_DURATION_MS,
} from './constants.js'
import { openFile } from './utils/open-file.js'
import { createLabel, createToolbar, createContextMenu } from './ui.js'
import cssText from './styles.css'

// --- State ---
let active = false
let overlay: OverlayCanvas | null = null
let hoveredEl: Element | null = null
let frozenEl: Element | null = null
let root: HTMLDivElement | null = null
let gatewayOrigin = ''

// --- UI components ---
let label: ReturnType<typeof createLabel> | null = null
let toolbar: ReturnType<typeof createToolbar> | null = null
let contextMenu: ReturnType<typeof createContextMenu> | null = null
let frozenGlow: HTMLDivElement | null = null

// --- Element detection (filters our own UI, caches position) ---

const isOwnElement = (el: Element): boolean => {
  const rootNode = el.getRootNode()
  if (rootNode instanceof ShadowRoot && rootNode.host.hasAttribute('data-element-grab')) return true
  if ((el as HTMLElement).hasAttribute?.('data-element-grab')) return true
  return false
}

const isGrabbable = (el: Element): boolean => {
  if (isOwnElement(el)) return false
  if (el === document.body || el === document.documentElement) return false
  const r = el.getBoundingClientRect()
  if (r.width / window.innerWidth > 0.9 && r.height / window.innerHeight > 0.9) {
    const cs = getComputedStyle(el)
    if (cs.pointerEvents === 'none' || cs.backgroundColor === 'transparent' || cs.backgroundColor === 'rgba(0, 0, 0, 0)') return false
  }
  return true
}

const getElementAtPoint = (x: number, y: number): Element | null => {
  const top = document.elementFromPoint(x, y)
  if (top && isGrabbable(top)) return top
  const stack = document.elementsFromPoint(x, y)
  for (const el of stack) {
    if (isGrabbable(el)) return el
  }
  return null
}

// --- Position cache ---
let cachedEl: Element | null = null
let cachedX = 0
let cachedY = 0
const CACHE_THRESHOLD = 2

// --- Initialization ---

const init = () => {
  if (root) return
  gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  root = mountRoot(cssText)
  overlay = new OverlayCanvas(root)

  label = createLabel(root, {
    onsubmit: handlePromptSubmit,
    onopen: handleOpenFile,
    ondismiss: deactivate,
  })

  toolbar = createToolbar(root, {
    ontoggle: () => { if (active) deactivate(); else activate() },
  })

  contextMenu = createContextMenu(root)

  // Frozen glow
  frozenGlow = document.createElement('div')
  Object.assign(frozenGlow.style, {
    position: 'fixed', top: '0', right: '0', bottom: '0', left: '0',
    pointerEvents: 'none', zIndex: String(Z_INDEX_OVERLAY_CANVAS),
    opacity: '0', transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
    willChange: 'opacity', contain: 'strict', transform: 'translateZ(0)',
    boxShadow: `inset 0 0 ${FROZEN_GLOW_EDGE_PX}px ${FROZEN_GLOW_COLOR}`,
  })
  root.appendChild(frozenGlow)

  // Right-click handler
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    if (!frozenEl || !contextMenu) return
    e.preventDefault()
    const bounds = frozenEl.getBoundingClientRect()
    contextMenu.show({
      position: { x: e.clientX, y: e.clientY },
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      tagName: frozenEl.tagName.toLowerCase(),
      componentName: getComponentDisplayName(frozenEl) || undefined,
      actions: [
        { label: 'Copy', shortcut: '⌘C', action: () => {
          const card = (window as any).__LAST_GRABBED__?.card
          if (card) navigator.clipboard.writeText(card).catch(() => {})
        }},
        { label: 'Copy HTML', action: () => {
          if (frozenEl) navigator.clipboard.writeText(frozenEl.outerHTML).catch(() => {})
        }},
        { label: 'Copy Styles', action: () => {
          if (!frozenEl) return
          const cs = getComputedStyle(frozenEl)
          const styles = Array.from(cs).filter(p => cs.getPropertyValue(p) !== '').map(p => `${p}: ${cs.getPropertyValue(p)};`).join('\n')
          navigator.clipboard.writeText(styles).catch(() => {})
        }},
        { label: 'Open in editor', shortcut: '⌘O', action: handleOpenFile },
      ],
      ondismiss: () => {},
    })
  }, true)

  console.log('[element-grab] Ready — hold Cmd+Shift+C to activate')
}

// --- Overlay bounds ---

const getBounds = (el: Element): OverlayBounds => {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return { x: r.x, y: r.y, width: r.width, height: r.height, borderRadius: cs.borderRadius || '0' }
}

// --- Hover detection ---

let lastMoveTime = 0

const onMouseMove = (e: MouseEvent) => {
  if (!active || frozenEl) return
  const now = Date.now()
  if (now - lastMoveTime < ELEMENT_DETECTION_THROTTLE_MS) return
  lastMoveTime = now

  if (cachedEl && Math.abs(e.clientX - cachedX) < CACHE_THRESHOLD && Math.abs(e.clientY - cachedY) < CACHE_THRESHOLD) return
  cachedX = e.clientX
  cachedY = e.clientY

  const target = getElementAtPoint(e.clientX, e.clientY)
  if (!target) return
  cachedEl = target

  hoveredEl = target
  const bounds = getBounds(target)

  if (overlay) {
    overlay.selectionVisible = true
    overlay.selectionFading = false
    overlay.setSelection(bounds)
  }

  label?.update({
    visible: true,
    tagName: target.tagName.toLowerCase(),
    componentName: getComponentDisplayName(target) || undefined,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    mouseX: e.clientX,
    status: 'hovering',
  })
}

// --- Click to grab ---

const onClick = async (e: MouseEvent) => {
  if (!active || !hoveredEl) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  const el = hoveredEl
  frozenEl = el
  if (frozenGlow) frozenGlow.style.opacity = '1'

  const bounds = getBounds(el)
  label?.update({
    status: 'frozen',
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  })

  const ctx = await getElementContext(el)
  const card = formatContextCard(ctx)

  ;(window as any).__LAST_GRABBED__ = {
    element: el, selector: ctx.selector, component: ctx.component, source: ctx.source, card,
  }
}

// --- Prompt submit ---

const handlePromptSubmit = async (promptText?: string) => {
  if (!frozenEl) return

  // Read prompt from argument or DOM
  const prompt = promptText?.trim() || label?.getPromptValue() || ''

  label?.update({ status: 'copying' })

  const ctx = await getElementContext(frozenEl)
  let card = formatContextCard(ctx)
  if (prompt) card += `\nprompt: ${prompt}`

  ;(window as any).__LAST_GRABBED__ = {
    element: frozenEl, selector: ctx.selector, component: ctx.component, source: ctx.source, card,
  }

  try {
    await fetch(`${gatewayOrigin}/__element-grab/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payload: { card, timestamp: Date.now(), url: window.location.href },
        browserId: sessionStorage.getItem('__web_dev_mcp_browser_id__'),
      }),
    })
  } catch {}

  try { await navigator.clipboard.writeText(card) } catch {}

  if (overlay) overlay.addGrabbed(`grab-${Date.now()}`, getBounds(frozenEl))

  label?.update({ status: 'copied' })
  console.log('[element-grab] Grabbed:\n' + card)

  setTimeout(() => {
    label?.update({ status: 'fading' })
    setTimeout(() => deactivate(), FADE_DURATION_MS)
  }, FEEDBACK_DURATION_MS)
}

// --- Open file ---

const handleOpenFile = () => {
  const grabbed = (window as any).__LAST_GRABBED__
  if (grabbed?.source?.file) openFile(grabbed.source.file, grabbed.source.line)
}

// --- Activation ---

const activate = () => {
  if (active) return
  init()
  active = true
  frozenEl = null
  cachedEl = null
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.body.style.cursor = 'crosshair'
  if (overlay) { overlay.selectionVisible = true; overlay.selectionFading = false }
  toolbar?.setActive(true)
}

const deactivate = () => {
  active = false
  hoveredEl = null
  frozenEl = null
  cachedEl = null
  document.removeEventListener('mousemove', onMouseMove, true)
  document.removeEventListener('click', onClick, true)
  document.body.style.cursor = ''
  if (overlay) { overlay.selectionVisible = false; overlay.setSelection(null) }
  label?.hide()
  contextMenu?.hide()
  toolbar?.setActive(false)
  if (frozenGlow) frozenGlow.style.opacity = '0'
}

// --- Keyboard: Cmd+C hold ---

let cmdHeld = false

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Meta' || e.key === 'Control') { cmdHeld = true; return }
  if (cmdHeld && e.key.toLowerCase() === ACTIVATION_KEY && (!REQUIRE_SHIFT || e.shiftKey)) {
    e.preventDefault()
    if (!active) activate()
  }
  if (e.key === 'Escape' && active) { e.preventDefault(); deactivate() }
}

const onKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = false
    if (active && !frozenEl) deactivate()
  }
}

document.addEventListener('keydown', onKeyDown, true)
document.addEventListener('keyup', onKeyUp, true)

// Init immediately so toolbar is visible
init()

// --- Expose API ---
;(window as any).__elementGrab = {
  activate,
  deactivate,
  isActive: () => active,
  async grabBySelector(selector: string): Promise<string | null> {
    init()
    const el = document.querySelector(selector)
    if (!el) return null
    hoveredEl = el
    frozenEl = el
    const ctx = await getElementContext(el)
    const card = formatContextCard(ctx)
    ;(window as any).__LAST_GRABBED__ = {
      element: el, selector: ctx.selector, component: ctx.component, source: ctx.source, card,
    }
    try {
      await fetch(`${gatewayOrigin}/__element-grab/selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: { card, timestamp: Date.now(), url: window.location.href },
          browserId: sessionStorage.getItem('__web_dev_mcp_browser_id__'),
        }),
      })
    } catch {}
    deactivate()
    return card
  },
}
