/**
 * DOM-based UI for element-grab — no framework dependency.
 * Creates/updates: SelectionLabel, Toolbar, ContextMenu.
 * All elements live inside a Shadow DOM root.
 */
import {
  VIEWPORT_MARGIN_PX, ARROW_HEIGHT_PX, ARROW_MIN_SIZE_PX,
  ARROW_MAX_LABEL_WIDTH_RATIO, ARROW_CENTER_PERCENT,
  ARROW_LABEL_MARGIN_PX, LABEL_GAP_PX, Z_INDEX_LABEL,
  TEXTAREA_MAX_HEIGHT_PX, FEEDBACK_DURATION_MS, FADE_DURATION_MS,
  TOOLBAR_SNAP_MARGIN_PX,
} from './constants.js'

// ─── Selection Label ──────────────────────────────────────────

interface LabelState {
  visible: boolean
  tagName: string
  componentName?: string
  bounds: { x: number; y: number; width: number; height: number } | null
  mouseX: number
  status: 'hovering' | 'frozen' | 'copying' | 'copied' | 'fading'
  filePath?: string
}

export function createLabel(root: HTMLElement, callbacks: {
  onsubmit: (prompt: string) => void
  onopen: () => void
  ondismiss: () => void
}) {
  const container = document.createElement('div')
  container.className = 'eg-label'
  container.style.display = 'none'
  root.appendChild(container)

  let state: LabelState = {
    visible: false, tagName: '', bounds: null, mouseX: 0, status: 'hovering',
  }

  const render = () => {
    if (!state.visible || !state.bounds) {
      container.style.display = 'none'
      return
    }
    container.style.display = ''

    // Position calculation
    const bounds = state.bounds
    const labelWidth = container.offsetWidth || 100
    const labelHeight = container.offsetHeight || 30
    const arrowSize = Math.max(ARROW_MIN_SIZE_PX, Math.min(ARROW_HEIGHT_PX, labelWidth * ARROW_MAX_LABEL_WIDTH_RATIO))

    const vw = window.visualViewport?.width ?? window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight
    const vLeft = window.visualViewport?.offsetLeft ?? 0
    const vTop = window.visualViewport?.offsetTop ?? 0

    const anchorX = state.mouseX || (bounds.x + bounds.width / 2)
    let edgeOffsetX = 0
    const halfLabel = labelWidth / 2

    if (anchorX + halfLabel > vLeft + vw - VIEWPORT_MARGIN_PX) {
      edgeOffsetX = vLeft + vw - VIEWPORT_MARGIN_PX - (anchorX + halfLabel)
    }
    if (anchorX - halfLabel + edgeOffsetX < vLeft + VIEWPORT_MARGIN_PX) {
      edgeOffsetX = vLeft + VIEWPORT_MARGIN_PX - (anchorX - halfLabel)
    }

    let top = bounds.y + bounds.height + arrowSize + LABEL_GAP_PX
    const fitsBelow = top + labelHeight <= vTop + vh - VIEWPORT_MARGIN_PX
    let arrowPos: 'bottom' | 'top' = 'bottom'

    if (!fitsBelow) {
      top = bounds.y - labelHeight - arrowSize - LABEL_GAP_PX
      arrowPos = 'top'
    }
    if (top < vTop + VIEWPORT_MARGIN_PX) top = vTop + VIEWPORT_MARGIN_PX

    // Arrow offset
    const arrowCenterPx = halfLabel - edgeOffsetX
    const arrowMinPx = Math.min(ARROW_LABEL_MARGIN_PX, halfLabel)
    const arrowMaxPx = Math.max(labelWidth - ARROW_LABEL_MARGIN_PX, halfLabel)
    const arrowLeftOffset = Math.max(arrowMinPx, Math.min(arrowMaxPx, arrowCenterPx)) - halfLabel

    container.style.top = `${top}px`
    container.style.left = `${anchorX}px`
    container.style.transform = `translateX(calc(-50% + ${edgeOffsetX}px))`
    container.style.zIndex = String(Z_INDEX_LABEL)
    container.style.opacity = state.status === 'fading' ? '0' : '1'
    container.style.pointerEvents = (state.status === 'frozen' || state.status === 'copying') ? 'auto' : 'none'

    // Build content
    const tagDisplay = state.componentName
      ? `<span class="eg-tag-component">${esc(state.componentName)}</span><span class="eg-tag-suffix">.${esc(state.tagName)}</span>`
      : `<span class="eg-tag-component">${esc(state.tagName)}</span>`

    // Arrow HTML
    const arrowStyle = arrowPos === 'bottom'
      ? `top:0;transform:translateX(-50%) translateY(-100%);border-bottom:${arrowSize}px solid white;`
      : `bottom:0;transform:translateX(-50%) translateY(100%);border-top:${arrowSize}px solid white;`
    const arrowHtml = `<div class="eg-arrow" style="left:calc(${ARROW_CENTER_PERCENT}% + ${arrowLeftOffset}px);border-left:${arrowSize}px solid transparent;border-right:${arrowSize}px solid transparent;${arrowStyle}"></div>`

    if (state.status === 'hovering') {
      container.innerHTML = `${arrowHtml}<div class="eg-panel animate-pop-in" style="padding:6px 8px"><div class="eg-tag"><span class="eg-tag-name">${tagDisplay}</span></div></div>`
    } else if (state.status === 'frozen') {
      container.innerHTML = `${arrowHtml}<div class="eg-panel" style="padding:0"><div style="display:flex;flex-direction:column;align-items:flex-start;min-width:150px;max-width:280px"><div style="display:flex;align-items:center;gap:4px;padding:6px 8px 4px 8px"><div class="eg-tag"><span class="eg-tag-name">${tagDisplay}</span></div></div><div class="eg-bottom-section"><div style="display:flex;justify-content:space-between;align-items:flex-end;width:100%;min-height:16px"><textarea class="eg-input" placeholder="Add context" rows="1" style="max-height:${TEXTAREA_MAX_HEIGHT_PX}px"></textarea><button class="eg-circle-btn eg-interactive-scale" aria-label="Submit"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button></div></div></div></div>`

      const textarea = container.querySelector('textarea')!
      const submitBtn = container.querySelector('.eg-circle-btn')!
      queueMicrotask(() => textarea.focus({ preventScroll: true }))

      textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopImmediatePropagation()
        if (e.code === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          callbacks.onsubmit(textarea.value)
        } else if (e.code === 'Escape') {
          e.preventDefault()
          callbacks.ondismiss()
        }
      })
      submitBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation()
        callbacks.onsubmit(textarea.value)
      })
    } else if (state.status === 'copying') {
      container.innerHTML = `${arrowHtml}<div class="eg-panel" style="padding:6px 8px"><span class="eg-status shimmer-text">Grabbing…</span></div>`
    } else if (state.status === 'copied') {
      container.innerHTML = `${arrowHtml}<div class="eg-panel animate-success-pop" style="padding:6px 8px"><span class="eg-status" style="color:black">Copied</span></div>`
    }
  }

  return {
    update(s: Partial<LabelState>) {
      Object.assign(state, s)
      render()
    },
    hide() {
      state.visible = false
      state.status = 'hovering'
      container.style.display = 'none'
    },
    getPromptValue(): string {
      return container.querySelector('textarea')?.value?.trim() || ''
    },
  }
}

// ─── Toolbar ──────────────────────────────────────────────────

export function createToolbar(root: HTMLElement, callbacks: { ontoggle: () => void }) {
  const STORAGE_KEY = 'element-grab-toolbar'
  const W = 40, H = 32

  let edge: 'top' | 'right' | 'bottom' | 'left' = 'right'
  let ratio = 0.5
  let isActive = false
  let dragging = false, dragStartX = 0, dragStartY = 0, hasDragged = false

  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (s.edge) edge = s.edge
    if (typeof s.ratio === 'number') ratio = s.ratio
  } catch {}

  const pill = document.createElement('div')
  pill.className = 'eg-toolbar-pill'
  pill.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg><div class="eg-toolbar-dot" style="display:none"></div>`
  root.appendChild(pill)

  const dot = pill.querySelector('.eg-toolbar-dot') as HTMLElement

  const updatePos = () => {
    const vw = window.innerWidth, vh = window.innerHeight, m = TOOLBAR_SNAP_MARGIN_PX
    let l: number, t: number
    switch (edge) {
      case 'right': l = vw - W - m; t = m + ratio * (vh - H - 2 * m); break
      case 'left': l = m; t = m + ratio * (vh - H - 2 * m); break
      case 'top': l = m + ratio * (vw - W - 2 * m); t = m; break
      case 'bottom': l = m + ratio * (vw - W - 2 * m); t = vh - H - m; break
    }
    pill.style.left = `${l!}px`
    pill.style.top = `${t!}px`
  }

  pill.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true; hasDragged = false; dragStartX = e.clientX; dragStartY = e.clientY
    try { pill.setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
  })

  pill.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return
    if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) hasDragged = true
    const vw = window.innerWidth, vh = window.innerHeight, m = TOOLBAR_SNAP_MARGIN_PX
    const dr = vw - e.clientX, dl = e.clientX, dt = e.clientY, db = vh - e.clientY
    const min = Math.min(dr, dl, dt, db)
    edge = min === dr ? 'right' : min === dl ? 'left' : min === dt ? 'top' : 'bottom'
    ratio = (edge === 'left' || edge === 'right')
      ? Math.max(0, Math.min(1, (e.clientY - m) / (vh - 2 * m)))
      : Math.max(0, Math.min(1, (e.clientX - m) / (vw - 2 * m)))
    updatePos()
  })

  pill.addEventListener('pointerup', (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    try { pill.releasePointerCapture(e.pointerId) } catch {}
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ edge, ratio })) } catch {}
    if (!hasDragged) callbacks.ontoggle()
  })

  updatePos()

  return {
    setActive(v: boolean) {
      isActive = v
      pill.classList.toggle('active', v)
      dot.style.display = v ? '' : 'none'
    },
  }
}

// ─── Context Menu ─────────────────────────────────────────────

interface MenuAction { label: string; shortcut?: string; action: () => void }

export function createContextMenu(root: HTMLElement) {
  const container = document.createElement('div')
  container.className = 'eg-label'
  container.style.display = 'none'
  container.style.pointerEvents = 'auto'
  root.appendChild(container)

  let dismissCb: (() => void) | null = null

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); hide() }
  }
  const handleClick = (e: MouseEvent) => {
    if (!container.contains(e.target as Node)) hide()
  }

  const show = (opts: {
    position: { x: number; y: number }
    bounds: { x: number; y: number; width: number; height: number }
    tagName: string
    componentName?: string
    actions: MenuAction[]
    ondismiss: () => void
  }) => {
    dismissCb = opts.ondismiss

    const tagDisplay = opts.componentName
      ? `<span class="eg-tag-component">${esc(opts.componentName)}</span><span class="eg-tag-suffix">.${esc(opts.tagName)}</span>`
      : `<span class="eg-tag-component">${esc(opts.tagName)}</span>`

    const items = opts.actions.map(a =>
      `<button class="eg-menu-item" data-action="${esc(a.label)}">${esc(a.label)}${a.shortcut ? `<span class="eg-menu-item-shortcut">${esc(a.shortcut)}</span>` : ''}</button>`
    ).join('')

    container.innerHTML = `<div class="eg-panel" style="flex-direction:column;align-items:flex-start;min-width:100px;padding:0"><div style="display:flex;align-items:center;gap:4px;padding:6px 8px 4px 8px"><span class="eg-tag-name">${tagDisplay}</span></div><div class="eg-bottom-section" style="padding:4px 0">${items}</div></div>`

    // Position below selection
    const arrowSize = ARROW_HEIGHT_PX
    let left = Math.max(LABEL_GAP_PX, Math.min(opts.position.x - 60, window.innerWidth - 140))
    let top = opts.bounds.y + opts.bounds.height + arrowSize + LABEL_GAP_PX

    container.style.display = ''
    const h = container.offsetHeight
    if (top + h > window.innerHeight) top = opts.bounds.y - h - arrowSize - LABEL_GAP_PX
    if (top < LABEL_GAP_PX) top = LABEL_GAP_PX

    container.style.left = `${left}px`
    container.style.top = `${top}px`
    container.style.zIndex = String(Z_INDEX_LABEL)

    // Bind actions
    container.querySelectorAll('.eg-menu-item').forEach(btn => {
      const label = btn.getAttribute('data-action')!
      const action = opts.actions.find(a => a.label === label)
      btn.addEventListener('click', (e) => {
        e.stopImmediatePropagation()
        action?.action()
        hide()
      })
    })

    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('pointerdown', handleClick, true)
  }

  const hide = () => {
    container.style.display = 'none'
    container.innerHTML = ''
    window.removeEventListener('keydown', handleKey, true)
    window.removeEventListener('pointerdown', handleClick, true)
    dismissCb?.()
    dismissCb = null
  }

  return { show, hide }
}

// ─── Helpers ──────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
