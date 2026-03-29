<script lang="ts">
  import {
    ARROW_HEIGHT_PX,
    LABEL_GAP_PX,
    Z_INDEX_LABEL,
  } from './constants'

  interface SelectionBounds {
    x: number
    y: number
    width: number
    height: number
  }

  interface MenuAction {
    label: string
    shortcut?: string
    action: () => void
  }

  interface Props {
    visible?: boolean
    position?: { x: number; y: number } | null
    selectionBounds?: SelectionBounds | null
    tagName?: string
    componentName?: string
    actions?: MenuAction[]
    ondismiss?: () => void
  }

  let {
    visible = false,
    position = null,
    selectionBounds = null,
    tagName = '',
    componentName,
    actions = [],
    ondismiss,
  }: Props = $props()

  let containerEl: HTMLDivElement | undefined = $state()
  let measuredWidth = $state(0)
  let measuredHeight = $state(0)
  let highlightTop = $state(0)
  let highlightHeight = $state(0)
  let highlightVisible = $state(false)

  // Measure on visibility change
  $effect(() => {
    if (visible && containerEl) {
      requestAnimationFrame(() => {
        if (!containerEl) return
        const r = containerEl.getBoundingClientRect()
        measuredWidth = r.width
        measuredHeight = r.height
      })
    }
  })

  // Dismiss on click outside or Escape
  $effect(() => {
    if (!visible) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        ondismiss?.()
      }
    }
    const handleClick = (e: MouseEvent) => {
      if (containerEl && !containerEl.contains(e.target as Node)) {
        ondismiss?.()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('pointerdown', handleClick, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      window.removeEventListener('pointerdown', handleClick, true)
    }
  })

  let computedPos = $derived.by(() => {
    const bounds = selectionBounds
    const click = position
    if (!bounds || !click || measuredWidth === 0) {
      return { left: -9999, top: -9999, arrowLeft: 0, arrowPosition: 'bottom' as const }
    }
    const cursorX = click.x
    const posLeft = Math.max(LABEL_GAP_PX, Math.min(cursorX - measuredWidth / 2, window.innerWidth - measuredWidth - LABEL_GAP_PX))
    const arrowLeft = Math.max(ARROW_HEIGHT_PX, Math.min(cursorX - posLeft, measuredWidth - ARROW_HEIGHT_PX))

    const posBelow = bounds.y + bounds.height + ARROW_HEIGHT_PX + LABEL_GAP_PX
    const posAbove = bounds.y - measuredHeight - ARROW_HEIGHT_PX - LABEL_GAP_PX
    const overflowBottom = posBelow + measuredHeight > window.innerHeight
    const hasSpaceAbove = posAbove >= 0
    const flipAbove = overflowBottom && hasSpaceAbove

    let posTop = flipAbove ? posAbove : posBelow
    let arrowPosition: 'top' | 'bottom' = flipAbove ? 'top' : 'bottom'

    if (overflowBottom && !hasSpaceAbove) {
      posTop = Math.max(LABEL_GAP_PX, Math.min(click.y + LABEL_GAP_PX, window.innerHeight - measuredHeight - LABEL_GAP_PX))
      arrowPosition = 'top'
    }

    return { left: posLeft, top: posTop, arrowLeft, arrowPosition }
  })

  function handlePointerEnter(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement
    const container = target.parentElement
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    highlightTop = targetRect.top - containerRect.top
    highlightHeight = targetRect.height
    highlightVisible = true
  }
</script>

{#if visible && position}
  <div
    bind:this={containerEl}
    class="eg-label animate-pop-in"
    style:top="{computedPos.top}px"
    style:left="{computedPos.left}px"
    style:z-index={Z_INDEX_LABEL}
    style:pointer-events="auto"
    onclick={(e) => e.stopImmediatePropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <!-- Arrow -->
    <div
      class="eg-arrow"
      style:left="{computedPos.arrowLeft}px"
      style:top={computedPos.arrowPosition === 'bottom' ? '0' : undefined}
      style:bottom={computedPos.arrowPosition === 'bottom' ? undefined : '0'}
      style:transform={computedPos.arrowPosition === 'bottom' ? 'translateX(-50%) translateY(-100%)' : 'translateX(-50%) translateY(100%)'}
      style:border-left="{ARROW_HEIGHT_PX}px solid transparent"
      style:border-right="{ARROW_HEIGHT_PX}px solid transparent"
      style:border-bottom={computedPos.arrowPosition === 'bottom' ? `${ARROW_HEIGHT_PX}px solid white` : undefined}
      style:border-top={computedPos.arrowPosition === 'bottom' ? undefined : `${ARROW_HEIGHT_PX}px solid white`}
    ></div>

    <div class="eg-panel" style="flex-direction:column; align-items:flex-start; min-width:100px; padding:0;">
      <!-- Tag badge header -->
      <div style="display:flex; align-items:center; gap:4px; padding:6px 8px 4px 8px;">
        <span class="eg-tag-name">
          {#if componentName}
            <span class="eg-tag-component">{componentName}</span><span class="eg-tag-suffix">.{tagName}</span>
          {:else}
            <span class="eg-tag-component">{tagName}</span>
          {/if}
        </span>
      </div>

      <!-- Actions list -->
      <div class="eg-bottom-section" style="position:relative; padding:4px 0;">
        <!-- Animated highlight -->
        <div
          class="eg-menu-highlight"
          style:top="{highlightTop}px"
          style:left="0"
          style:width="100%"
          style:height="{highlightHeight}px"
          style:opacity={highlightVisible ? 1 : 0}
          style:border-radius="4px"
        ></div>

        {#each actions as item}
          <button
            class="eg-menu-item"
            onpointerenter={handlePointerEnter}
            onpointerleave={() => highlightVisible = false}
            onclick={(e) => { e.stopPropagation(); item.action(); ondismiss?.(); }}
          >
            <span>{item.label}</span>
            {#if item.shortcut}
              <span class="eg-menu-item-shortcut">{item.shortcut}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
