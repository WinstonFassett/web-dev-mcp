<script lang="ts">
  import {
    TOOLBAR_SNAP_MARGIN_PX,
    TOOLBAR_COLLAPSED_SHORT_PX,
    TOOLBAR_COLLAPSED_LONG_PX,
    Z_INDEX_LABEL,
  } from './constants'

  type SnapEdge = 'top' | 'right' | 'bottom' | 'left'

  interface Props {
    isActive?: boolean
    ontoggle?: () => void
  }

  let { isActive = false, ontoggle }: Props = $props()

  const STORAGE_KEY = 'element-grab-toolbar'
  const PILL_WIDTH = 78
  const PILL_HEIGHT = 28

  let edge = $state<SnapEdge>('right')
  let ratio = $state(0.5) // 0-1 position along the edge
  let expanded = $state(false)
  let dragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let dragStartRatio = 0
  let dragStartEdge: SnapEdge = 'right'
  let hasDragged = false

  // Load from localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const s = JSON.parse(saved)
      if (s.edge) edge = s.edge
      if (typeof s.ratio === 'number') ratio = s.ratio
    }
  } catch {}

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ edge, ratio })) } catch {}
  }

  // --- Position calculation ---

  let pos = $derived.by(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const m = TOOLBAR_SNAP_MARGIN_PX
    const w = expanded ? PILL_WIDTH : (edge === 'left' || edge === 'right' ? TOOLBAR_COLLAPSED_SHORT_PX : TOOLBAR_COLLAPSED_LONG_PX)
    const h = expanded ? PILL_HEIGHT : (edge === 'top' || edge === 'bottom' ? TOOLBAR_COLLAPSED_SHORT_PX : TOOLBAR_COLLAPSED_LONG_PX)

    switch (edge) {
      case 'right':
        return { left: vw - w - m, top: m + ratio * (vh - h - 2 * m) }
      case 'left':
        return { left: m, top: m + ratio * (vh - h - 2 * m) }
      case 'top':
        return { left: m + ratio * (vw - w - 2 * m), top: m }
      case 'bottom':
        return { left: m + ratio * (vw - w - 2 * m), top: vh - h - m }
    }
  })

  let pillStyle = $derived.by(() => {
    const w = expanded ? PILL_WIDTH : (edge === 'left' || edge === 'right' ? TOOLBAR_COLLAPSED_SHORT_PX : TOOLBAR_COLLAPSED_LONG_PX)
    const h = expanded ? PILL_HEIGHT : (edge === 'top' || edge === 'bottom' ? TOOLBAR_COLLAPSED_SHORT_PX : TOOLBAR_COLLAPSED_LONG_PX)
    return {
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      width: `${w}px`,
      height: `${h}px`,
    }
  })

  // --- Expand on hover/active ---

  $effect(() => {
    if (isActive) expanded = true
  })

  // --- Drag handling ---

  function onPointerDown(e: PointerEvent) {
    dragging = true
    hasDragged = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    dragStartRatio = ratio
    dragStartEdge = edge
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged = true

    const vw = window.innerWidth
    const vh = window.innerHeight

    // Determine which edge we're closest to
    const distRight = vw - e.clientX
    const distLeft = e.clientX
    const distTop = e.clientY
    const distBottom = vh - e.clientY
    const minDist = Math.min(distRight, distLeft, distTop, distBottom)

    if (minDist === distRight) edge = 'right'
    else if (minDist === distLeft) edge = 'left'
    else if (minDist === distTop) edge = 'top'
    else edge = 'bottom'

    // Calculate ratio along the edge
    const m = TOOLBAR_SNAP_MARGIN_PX
    if (edge === 'left' || edge === 'right') {
      ratio = Math.max(0, Math.min(1, (e.clientY - m) / (vh - 2 * m)))
    } else {
      ratio = Math.max(0, Math.min(1, (e.clientX - m) / (vw - 2 * m)))
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return
    dragging = false
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch {}
    save()
    // If it was a click (not a drag), toggle
    if (!hasDragged) {
      ontoggle?.()
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="eg-toolbar"
  class:expanded
  class:active={isActive}
  style:left={pillStyle.left}
  style:top={pillStyle.top}
  style:width={pillStyle.width}
  style:height={pillStyle.height}
  style:z-index={Z_INDEX_LABEL}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onmouseenter={() => expanded = true}
  onmouseleave={() => { if (!isActive) expanded = false }}
>
  {#if expanded}
    <div class="eg-toolbar-content">
      <div class="eg-toolbar-btn" class:active={isActive}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" />
        </svg>
      </div>
      <span class="eg-toolbar-label">{isActive ? 'Active' : 'Grab'}</span>
    </div>
  {/if}
</div>

<style>
  .eg-toolbar {
    position: fixed;
    pointer-events: auto;
    cursor: grab;
    background: white;
    border-radius: 14px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    transition: width 150ms ease, height 150ms ease, border-radius 150ms ease, background 150ms ease;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .eg-toolbar:not(.expanded) {
    background: rgba(0,0,0,0.12);
    border-radius: 7px;
    cursor: pointer;
  }

  .eg-toolbar:not(.expanded):hover {
    background: rgba(0,0,0,0.2);
  }

  .eg-toolbar.active {
    background: #6366f1;
  }

  .eg-toolbar.active:not(.expanded) {
    background: #6366f1;
  }

  .eg-toolbar-content {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    height: 100%;
    white-space: nowrap;
  }

  .eg-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    color: black;
    flex-shrink: 0;
  }

  .eg-toolbar-btn.active {
    color: white;
  }

  .eg-toolbar-label {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: black;
    line-height: 1;
  }

  .eg-toolbar.active .eg-toolbar-label {
    color: white;
  }
</style>
