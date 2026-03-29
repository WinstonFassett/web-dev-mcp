/**
 * element-grab: framework-agnostic UI element selection with MCP relay.
 * High-fidelity port of react-grab's UI, using Svelte for components,
 * bippy for React fiber introspection, element-source for source resolution.
 */
import { mount, unmount } from 'svelte'
import { mountRoot } from './utils/mount-root.js'
import { OverlayCanvas } from './overlay-canvas.js'
import type { OverlayBounds } from './overlay-canvas.js'
import { getElementContext, formatContextCard, getComponentDisplayName } from './context.js'
import { ELEMENT_DETECTION_THROTTLE_MS, ACTIVATION_KEY, FROZEN_GLOW_COLOR, FROZEN_GLOW_EDGE_PX, Z_INDEX_OVERLAY_CANVAS, FADE_DURATION_MS, FEEDBACK_DURATION_MS } from './constants.js'
import { openFile } from './utils/open-file.js'
import cssText from './styles.css'
import SelectionLabel from './SelectionLabel.svelte'
import ContextMenu from './ContextMenu.svelte'
import Toolbar from './Toolbar.svelte'
import { getHTMLPreview } from './context.js'
import { createElementSelector } from './utils/css-selector.js'

// --- State ---
let active = $state(false)
let overlay: OverlayCanvas | null = null
let hoveredEl: Element | null = null
let frozenEl: Element | null = null
let root: HTMLDivElement | null = null
let shadowRoot: ShadowRoot | null = null
let gatewayOrigin = ''

// --- Svelte component state (reactive via object reference) ---
let labelProps = $state({
  visible: false,
  tagName: '',
  componentName: undefined as string | undefined,
  selectionBounds: null as { x: number; y: number; width: number; height: number } | null,
  mouseX: 0,
  status: 'hovering' as 'hovering' | 'frozen' | 'copying' | 'copied' | 'fading',
  filePath: undefined as string | undefined,
  lineNumber: undefined as number | undefined,
  inputValue: '',
})

let menuProps = $state({
  visible: false,
  position: null as { x: number; y: number } | null,
  selectionBounds: null as { x: number; y: number; width: number; height: number } | null,
  tagName: '',
  componentName: undefined as string | undefined,
})

let labelComponent: ReturnType<typeof mount> | null = null
let frozenGlow: HTMLDivElement | null = null

// --- Initialization ---

const init = () => {
  if (root) return
  gatewayOrigin = (window as any).__WEB_DEV_MCP_ORIGIN__ || window.location.origin
  const result = mountRoot(cssText)
  root = result
  shadowRoot = root.shadowRoot || root.parentNode as ShadowRoot
  overlay = new OverlayCanvas(root)

  // Mount SelectionLabel into shadow DOM
  labelComponent = mount(SelectionLabel, {
    target: root,
    props: {
      get visible() { return labelProps.visible },
      get tagName() { return labelProps.tagName },
      get componentName() { return labelProps.componentName },
      get selectionBounds() { return labelProps.selectionBounds },
      get mouseX() { return labelProps.mouseX },
      get status() { return labelProps.status },
      get filePath() { return labelProps.filePath },
      get lineNumber() { return labelProps.lineNumber },
      get inputValue() { return labelProps.inputValue },
      oninputchange: (value: string) => { labelProps.inputValue = value },
      onsubmit: handlePromptSubmit,
      onopen: handleOpenFile,
      ondismiss: deactivate,
    },
  })

  // Frozen glow overlay
  frozenGlow = document.createElement('div')
  Object.assign(frozenGlow.style, {
    position: 'fixed',
    top: '0', right: '0', bottom: '0', left: '0',
    pointerEvents: 'none',
    zIndex: String(Z_INDEX_OVERLAY_CANVAS),
    opacity: '0',
    transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
    willChange: 'opacity',
    contain: 'strict',
    transform: 'translateZ(0)',
    boxShadow: `inset 0 0 ${FROZEN_GLOW_EDGE_PX}px ${FROZEN_GLOW_COLOR}`,
  })
  root.appendChild(frozenGlow)

  // Mount ContextMenu into shadow DOM
  const menuActions = [
    {
      label: 'Copy',
      shortcut: '⌘C',
      action: () => {
        const card = (window as any).__LAST_GRABBED__?.card
        if (card) navigator.clipboard.writeText(card).catch(() => {})
      },
    },
    {
      label: 'Copy HTML',
      action: () => {
        if (frozenEl) navigator.clipboard.writeText(frozenEl.outerHTML).catch(() => {})
      },
    },
    {
      label: 'Copy Styles',
      action: () => {
        if (!frozenEl) return
        const cs = getComputedStyle(frozenEl)
        const styles = Array.from(cs).filter(p => cs.getPropertyValue(p) !== '').map(p => `${p}: ${cs.getPropertyValue(p)};`).join('\n')
        navigator.clipboard.writeText(styles).catch(() => {})
      },
    },
    {
      label: 'Open in editor',
      shortcut: '⌘O',
      action: () => handleOpenFile(),
    },
  ]

  mount(ContextMenu, {
    target: root,
    props: {
      get visible() { return menuProps.visible },
      get position() { return menuProps.position },
      get selectionBounds() { return menuProps.selectionBounds },
      get tagName() { return menuProps.tagName },
      get componentName() { return menuProps.componentName },
      actions: menuActions,
      ondismiss: () => { menuProps.visible = false },
    },
  })

  // Right-click handler for context menu
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    if (!frozenEl) return
    e.preventDefault()
    menuProps.visible = true
    menuProps.position = { x: e.clientX, y: e.clientY }
    const bounds = frozenEl.getBoundingClientRect()
    menuProps.selectionBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    menuProps.tagName = labelProps.tagName
    menuProps.componentName = labelProps.componentName
  }, true)

  // Mount Toolbar into shadow DOM
  mount(Toolbar, {
    target: root,
    props: {
      get isActive() { return active },
      ontoggle: () => {
        if (active) deactivate()
        else activate()
      },
    },
  })

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

// --- Element detection (filters our own UI, caches position) ---

const isOwnElement = (el: Element): boolean => {
  // Check if element is inside our Shadow DOM
  const rootNode = el.getRootNode()
  if (rootNode instanceof ShadowRoot && rootNode.host.hasAttribute('data-element-grab')) return true
  // Check if element IS our host
  if (el.hasAttribute?.('data-element-grab')) return true
  return false
}

const isGrabbable = (el: Element): boolean => {
  if (isOwnElement(el)) return false
  // Skip root elements
  if (el === document.body || el === document.documentElement) return false
  // Skip full-viewport transparent overlays
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
  // Walk the stack if top element is our own UI
  const stack = document.elementsFromPoint(x, y)
  for (const el of stack) {
    if (isGrabbable(el)) return el
  }
  return null
}

// --- Position cache (avoid jitter on sub-pixel mouse moves) ---

let cachedEl: Element | null = null
let cachedX = 0
let cachedY = 0
const CACHE_THRESHOLD = 2

// --- Hover detection (throttled) ---

let lastMoveTime = 0

const onMouseMove = (e: MouseEvent) => {
  if (!active || frozenEl) return
  const now = Date.now()
  if (now - lastMoveTime < ELEMENT_DETECTION_THROTTLE_MS) return
  lastMoveTime = now

  // Use cached element if mouse barely moved
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

  // Update label (sync — only need component name for hover)
  labelProps.visible = true
  labelProps.tagName = target.tagName.toLowerCase()
  labelProps.componentName = getComponentDisplayName(target) || undefined
  labelProps.selectionBounds = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  labelProps.mouseX = e.clientX
  labelProps.status = 'hovering'
  labelProps.filePath = undefined
  labelProps.lineNumber = undefined
}

// --- Click to grab ---

const onClick = async (e: MouseEvent) => {
  if (!active || !hoveredEl) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()

  const el = hoveredEl
  frozenEl = el

  // Show frozen state with prompt
  labelProps.status = 'frozen'
  labelProps.inputValue = ''
  if (frozenGlow) frozenGlow.style.opacity = '1'

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
}

// --- Handle prompt submit ---

const handlePromptSubmit = async () => {
  if (!frozenEl) return

  labelProps.status = 'copying'

  const ctx = await getElementContext(frozenEl)
  let card = formatContextCard(ctx)

  // Read prompt from labelProps or directly from the textarea DOM
  const promptText = labelProps.inputValue?.trim()
    || root?.querySelector?.('textarea')?.value?.trim()
    || ''
  if (promptText) {
    card += `\nprompt: ${promptText}`
  }

  // Update global
  ;(window as any).__LAST_GRABBED__.card = card

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
    overlay.addGrabbed(`grab-${Date.now()}`, getBounds(frozenEl))
  }

  // Show copied state
  labelProps.status = 'copied'
  console.log('[element-grab] Grabbed:\n' + card)

  // Fade out and deactivate
  setTimeout(() => {
    labelProps.status = 'fading'
    setTimeout(() => deactivate(), FADE_DURATION_MS)
  }, FEEDBACK_DURATION_MS)
}

// --- Open file in editor ---

const handleOpenFile = () => {
  if (labelProps.filePath) {
    openFile(labelProps.filePath, labelProps.lineNumber)
  }
}

// --- Activation ---

const activate = () => {
  if (active) return
  init()
  active = true
  frozenEl = null
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
  frozenEl = null
  document.removeEventListener('mousemove', onMouseMove, true)
  document.removeEventListener('click', onClick, true)
  document.body.style.cursor = ''
  if (overlay) {
    overlay.selectionVisible = false
    overlay.setSelection(null)
  }
  labelProps.visible = false
  labelProps.status = 'hovering'
  menuProps.visible = false
  if (frozenGlow) frozenGlow.style.opacity = '0'
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

// Initialize immediately so toolbar is visible on page load
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
    // Trigger grab flow
    frozenEl = el
    const ctx = await getElementContext(el)
    const card = formatContextCard(ctx)
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
    deactivate()
    return card
  },
}
