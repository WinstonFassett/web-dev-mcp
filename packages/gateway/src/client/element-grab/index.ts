/**
 * element-grab: framework-agnostic UI element selection with MCP relay.
 * High-fidelity port of react-grab's UI, using Svelte for components,
 * bippy for React fiber introspection, element-source for source resolution.
 */
import { mountRoot } from './utils/mount-root.js'
import { OverlayCanvas } from './overlay-canvas.js'
import type { OverlayBounds } from './overlay-canvas.js'
import { getElementContext, formatContextCard, getComponentDisplayName } from './context.js'
import { ELEMENT_DETECTION_THROTTLE_MS, ACTIVATION_KEY } from './constants.js'
import cssText from './styles.css'

// --- State ---
let active = false
let overlay: OverlayCanvas | null = null
let hoveredEl: Element | null = null
let frozenEl: Element | null = null
let root: HTMLDivElement | null = null
let gatewayOrigin = ''

// --- Initialization ---

const init = () => {
  if (root) return
  gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  root = mountRoot(cssText)
  overlay = new OverlayCanvas(root)
  console.log('[element-grab] Ready — hold Cmd+C to activate')
}

// --- Overlay bounds from element ---

const getBounds = (el: Element): OverlayBounds => {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    x: r.x, y: r.y, width: r.width, height: r.height,
    borderRadius: cs.borderRadius || '0',
  }
}

// --- Hover detection (throttled) ---

let lastMoveTime = 0

const onMouseMove = (e: MouseEvent) => {
  if (!active) return
  const now = Date.now()
  if (now - lastMoveTime < ELEMENT_DETECTION_THROTTLE_MS) return
  lastMoveTime = now

  const target = document.elementFromPoint(e.clientX, e.clientY)
  if (!target || target === root || root?.contains(target)) return

  hoveredEl = target
  if (overlay) {
    overlay.selectionVisible = true
    overlay.selectionFading = false
    overlay.setSelection(getBounds(target))
  }
}

// --- Click to grab ---

const onClick = async (e: MouseEvent) => {
  if (!active || !hoveredEl) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  const el = hoveredEl
  frozenEl = el

  // Get context
  const ctx = await getElementContext(el)
  const card = formatContextCard(ctx)

  // Set global for live ref access
  ;(window as any).__LAST_GRABBED__ = {
    element: el,
    selector: ctx.selector,
    component: ctx.component,
    source: ctx.source,
    card,
  }

  // Send to gateway
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

  // Copy to clipboard
  try { await navigator.clipboard.writeText(card) } catch {}

  // Flash grabbed feedback
  if (overlay) {
    overlay.addGrabbed(`grab-${Date.now()}`, getBounds(el))
  }

  console.log('[element-grab] Grabbed:\n' + card)
  deactivate()
}

// --- Activation ---

const activate = () => {
  if (active) return
  init()
  active = true
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('click', onClick, true)
  document.body.style.cursor = 'crosshair'
  if (overlay) {
    overlay.selectionVisible = true
    overlay.selectionFading = false
  }
}

const deactivate = () => {
  active = false
  hoveredEl = null
  document.removeEventListener('mousemove', onMouseMove, true)
  document.removeEventListener('click', onClick, true)
  document.body.style.cursor = ''
  if (overlay) {
    overlay.selectionVisible = false
    overlay.setSelection(null)
  }
}

// --- Keyboard: Cmd+C hold ---

let cmdHeld = false

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = true
    return
  }
  if (cmdHeld && e.key.toLowerCase() === ACTIVATION_KEY) {
    e.preventDefault()
    if (!active) activate()
  }
  // Escape to cancel
  if (e.key === 'Escape' && active) {
    e.preventDefault()
    deactivate()
  }
}

const onKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Meta' || e.key === 'Control') {
    cmdHeld = false
    if (active && !frozenEl) deactivate()
  }
}

document.addEventListener('keydown', onKeyDown, true)
document.addEventListener('keyup', onKeyUp, true)

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
    // Simulate click flow
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} } as any
    await onClick(fakeEvent)
    return (window as any).__LAST_GRABBED__?.card ?? null
  },
}
