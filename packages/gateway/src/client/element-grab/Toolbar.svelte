<script lang="ts">
  import {
    TOOLBAR_SNAP_MARGIN_PX,
    Z_INDEX_LABEL,
  } from './constants'

  type SnapEdge = 'top' | 'right' | 'bottom' | 'left'

  interface Props {
    isActive?: boolean
    ontoggle?: () => void
  }

  let { isActive = false, ontoggle }: Props = $props()

  const STORAGE_KEY = 'element-grab-toolbar'
  const PILL_WIDTH = 40
  const PILL_HEIGHT = 32

  let edge = $state<SnapEdge>('right')
  let ratio = $state(0.5)
  let dragging = $state(false)
  let dragStartX = 0
  let dragStartY = 0
  let hasDragged = false

  // Load position from localStorage
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

  let pos = $derived.by(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const m = TOOLBAR_SNAP_MARGIN_PX
    switch (edge) {
      case 'right': return { left: vw - PILL_WIDTH - m, top: m + ratio * (vh - PILL_HEIGHT - 2 * m) }
      case 'left': return { left: m, top: m + ratio * (vh - PILL_HEIGHT - 2 * m) }
      case 'top': return { left: m + ratio * (vw - PILL_WIDTH - 2 * m), top: m }
      case 'bottom': return { left: m + ratio * (vw - PILL_WIDTH - 2 * m), top: vh - PILL_HEIGHT - m }
    }
  })

  function onPointerDown(e: PointerEvent) {
    dragging = true
    hasDragged = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
    e.preventDefault()
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) hasDragged = true

    const vw = window.innerWidth
    const vh = window.innerHeight
    const distRight = vw - e.clientX
    const distLeft = e.clientX
    const distTop = e.clientY
    const distBottom = vh - e.clientY
    const minDist = Math.min(distRight, distLeft, distTop, distBottom)

    if (minDist === distRight) edge = 'right'
    else if (minDist === distLeft) edge = 'left'
    else if (minDist === distTop) edge = 'top'
    else edge = 'bottom'

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
    if (!hasDragged) ontoggle?.()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="eg-toolbar-pill"
  class:active={isActive}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:z-index={Z_INDEX_LABEL}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  <!-- Cursor select icon -->
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /><path d="M13 13l6 6" />
  </svg>
  <!-- Active indicator dot -->
  {#if isActive}
    <div class="eg-toolbar-dot"></div>
  {/if}
</div>

<style>
  .eg-toolbar-pill {
    position: fixed;
    pointer-events: auto;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 40px;
    height: 32px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.06);
    transition: background 150ms ease, box-shadow 150ms ease, transform 150ms ease;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    color: rgba(0,0,0,0.5);
  }

  .eg-toolbar-pill:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.08);
    color: rgba(0,0,0,0.8);
    transform: scale(1.05);
  }

  .eg-toolbar-pill:active {
    transform: scale(0.97);
  }

  .eg-toolbar-pill.active {
    background: #6366f1;
    color: white;
    box-shadow: 0 2px 8px rgba(99,102,241,0.4), 0 0 0 0.5px rgba(99,102,241,0.3);
  }

  .eg-toolbar-pill.active:hover {
    background: #5558e6;
    box-shadow: 0 2px 12px rgba(99,102,241,0.5), 0 0 0 0.5px rgba(99,102,241,0.4);
  }

  .eg-toolbar-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    opacity: 0.8;
    flex-shrink: 0;
  }
</style>
