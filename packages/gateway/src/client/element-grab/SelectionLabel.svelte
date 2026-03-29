<script lang="ts">
  import {
    VIEWPORT_MARGIN_PX,
    ARROW_CENTER_PERCENT,
    ARROW_LABEL_MARGIN_PX,
    ARROW_HEIGHT_PX,
    ARROW_MIN_SIZE_PX,
    ARROW_MAX_LABEL_WIDTH_RATIO,
    LABEL_GAP_PX,
    TEXTAREA_MAX_HEIGHT_PX,
    Z_INDEX_LABEL,
  } from './constants'

  interface SelectionBounds {
    x: number
    y: number
    width: number
    height: number
  }

  interface Props {
    tagName?: string
    componentName?: string
    selectionBounds?: SelectionBounds | null
    mouseX?: number
    visible?: boolean
    status?: 'hovering' | 'frozen' | 'copying' | 'copied' | 'fading'
    filePath?: string
    lineNumber?: number
    inputValue?: string
    oninputchange?: (value: string) => void
    onsubmit?: () => void
    onopen?: () => void
    ondismiss?: () => void
  }

  let {
    tagName = '',
    componentName,
    selectionBounds = null,
    mouseX,
    visible = true,
    status = 'hovering',
    filePath,
    lineNumber,
    inputValue = '',
    oninputchange,
    onsubmit,
    onopen,
    ondismiss,
  }: Props = $props()

  let containerEl: HTMLDivElement | undefined = $state()
  let panelEl: HTMLDivElement | undefined = $state()
  let inputEl: HTMLTextAreaElement | undefined = $state()
  let measuredWidth = $state(0)
  let measuredHeight = $state(0)
  let panelWidth = $state(0)
  let isShaking = $state(false)
  let isTagHovered = $state(false)

  // --- Positioning logic (ported from react-grab) ---

  let arrowSize = $derived(
    panelWidth <= 0
      ? ARROW_HEIGHT_PX
      : Math.max(ARROW_MIN_SIZE_PX, Math.min(ARROW_HEIGHT_PX, panelWidth * ARROW_MAX_LABEL_WIDTH_RATIO))
  )

  let isPromptMode = $derived(status === 'frozen')
  let isCopying = $derived(status === 'copying')
  let isCopied = $derived(status === 'copied' || status === 'fading')
  let isFading = $derived(status === 'fading')
  let canInteract = $derived(status !== 'copying' && status !== 'copied' && status !== 'fading')

  let position = $derived.by(() => {
    const OFFSCREEN = -9999
    const bounds = selectionBounds
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return { left: OFFSCREEN, top: OFFSCREEN, arrowLeftPercent: ARROW_CENTER_PERCENT, arrowLeftOffset: 0, edgeOffsetX: 0, arrowPosition: 'bottom' as const }
    }

    const vw = window.visualViewport
    const vLeft = vw?.offsetLeft ?? 0
    const vTop = vw?.offsetTop ?? 0
    const vRight = vLeft + (vw?.width ?? window.innerWidth)
    const vBottom = vTop + (vw?.height ?? window.innerHeight)

    const selCenterX = bounds.x + bounds.width / 2
    const cursorX = mouseX ?? selCenterX
    const selBottom = bounds.y + bounds.height
    const selTop = bounds.y

    const anchorX = cursorX
    let edgeOffsetX = 0
    let posTop = selBottom + arrowSize + LABEL_GAP_PX

    if (measuredWidth > 0) {
      const labelLeft = anchorX - measuredWidth / 2
      const labelRight = anchorX + measuredWidth / 2
      if (labelRight > vRight - VIEWPORT_MARGIN_PX) {
        edgeOffsetX = vRight - VIEWPORT_MARGIN_PX - labelRight
      }
      if (labelLeft + edgeOffsetX < vLeft + VIEWPORT_MARGIN_PX) {
        edgeOffsetX = vLeft + VIEWPORT_MARGIN_PX - labelLeft
      }
    }

    const totalHeight = measuredHeight + arrowSize + LABEL_GAP_PX
    const fitsBelow = posTop + measuredHeight <= vBottom - VIEWPORT_MARGIN_PX

    if (!fitsBelow) {
      posTop = selTop - totalHeight
    }
    if (posTop < vTop + VIEWPORT_MARGIN_PX) {
      posTop = vTop + VIEWPORT_MARGIN_PX
    }

    const labelHalf = measuredWidth / 2
    const arrowCenterPx = labelHalf - edgeOffsetX
    const arrowMinPx = Math.min(ARROW_LABEL_MARGIN_PX, labelHalf)
    const arrowMaxPx = Math.max(measuredWidth - ARROW_LABEL_MARGIN_PX, labelHalf)
    const clampedArrow = Math.max(arrowMinPx, Math.min(arrowMaxPx, arrowCenterPx))
    const arrowLeftOffset = clampedArrow - labelHalf

    return {
      left: anchorX,
      top: posTop,
      arrowLeftPercent: ARROW_CENTER_PERCENT,
      arrowLeftOffset,
      edgeOffsetX,
      arrowPosition: fitsBelow ? 'bottom' as const : 'top' as const,
    }
  })

  // --- ResizeObserver ---

  $effect(() => {
    if (!containerEl || !panelEl) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.target.getBoundingClientRect()
        if (entry.target === containerEl) {
          measuredWidth = rect.width
          measuredHeight = rect.height
        } else if (entry.target === panelEl) {
          panelWidth = rect.width
        }
      }
    })
    ro.observe(containerEl)
    ro.observe(panelEl)
    // Initial measurement
    measuredWidth = containerEl.getBoundingClientRect().width
    measuredHeight = containerEl.getBoundingClientRect().height
    panelWidth = panelEl.getBoundingClientRect().width
    return () => ro.disconnect()
  })

  // --- Auto-focus input when entering prompt mode ---

  $effect(() => {
    if (isPromptMode && inputEl) {
      queueMicrotask(() => inputEl?.focus({ preventScroll: true }))
    }
  })

  // --- Input handlers ---

  function handleKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return
    e.stopImmediatePropagation()
    if (e.code === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onsubmit?.()
    } else if (e.code === 'Escape') {
      e.preventDefault()
      ondismiss?.()
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    if (target.scrollHeight > target.clientHeight && target.clientHeight < TEXTAREA_MAX_HEIGHT_PX) {
      target.style.height = 'auto'
      target.style.height = Math.min(target.scrollHeight, TEXTAREA_MAX_HEIGHT_PX) + 'px'
    }
    oninputchange?.(target.value)
  }

  function handleTagClick(e: MouseEvent) {
    e.stopImmediatePropagation()
    if (filePath && onopen) onopen()
  }
</script>

{#if visible && selectionBounds}
  <div
    bind:this={containerEl}
    class="eg-label"
    style:top="{position.top}px"
    style:left="{position.left}px"
    style:transform="translateX(calc(-50% + {position.edgeOffsetX}px))"
    style:z-index={Z_INDEX_LABEL}
    style:pointer-events={canInteract && isPromptMode ? 'auto' : isCopying ? 'auto' : 'none'}
    style:opacity={isFading ? 0 : 1}
    onclick={(e) => e.stopImmediatePropagation()}
  >
    <!-- Arrow -->
    <div
      class="eg-arrow"
      style:left="calc({position.arrowLeftPercent}% + {position.arrowLeftOffset}px)"
      style:top={position.arrowPosition === 'bottom' ? '0' : undefined}
      style:bottom={position.arrowPosition === 'bottom' ? undefined : '0'}
      style:transform={position.arrowPosition === 'bottom' ? 'translateX(-50%) translateY(-100%)' : 'translateX(-50%) translateY(100%)'}
      style:border-left="{arrowSize}px solid transparent"
      style:border-right="{arrowSize}px solid transparent"
      style:border-bottom={position.arrowPosition === 'bottom' ? `${arrowSize}px solid white` : undefined}
      style:border-top={position.arrowPosition === 'bottom' ? undefined : `${arrowSize}px solid white`}
    ></div>

    <!-- Copied state -->
    {#if isCopied}
      <div bind:this={panelEl} class="eg-panel animate-success-pop" style:padding="6px 8px">
        <span class="eg-status" style:color="black">Copied</span>
      </div>

    <!-- Copying state -->
    {:else if isCopying}
      <div bind:this={panelEl} class="eg-panel" style:padding="6px 8px">
        <span class="eg-status shimmer-text">Grabbing…</span>
      </div>

    <!-- Frozen: tag + prompt -->
    {:else if isPromptMode}
      <div bind:this={panelEl} class="eg-panel" class:animate-shake={isShaking} onanimationend={() => isShaking = false}>
        <div style="display:flex; flex-direction:column; align-items:flex-start; min-width:150px; max-width:280px;">
          <div style="display:flex; align-items:center; gap:4px; padding:6px 8px 4px 8px; max-width:100%;">
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="eg-tag"
              class:cursor-pointer={!!filePath}
              onmouseenter={() => isTagHovered = true}
              onmouseleave={() => isTagHovered = false}
              onclick={handleTagClick}
            >
              <span class="eg-tag-name">
                {#if componentName}
                  <span class="eg-tag-component">{componentName}</span><span class="eg-tag-suffix">.{tagName}</span>
                {:else}
                  <span class="eg-tag-component">{tagName}</span>
                {/if}
              </span>
              {#if filePath}
                <svg
                  xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  class="eg-tag-open-icon" class:visible={isTagHovered} class:hidden={!isTagHovered}
                >
                  <path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /><path d="M11 13l9-9" /><path d="M15 4h5v5" />
                </svg>
              {/if}
            </div>
          </div>
          <div class="eg-bottom-section">
            <div style="display:flex; justify-content:space-between; align-items:flex-end; width:100%; min-height:16px;">
              <textarea
                bind:this={inputEl}
                class="eg-input"
                value={inputValue}
                oninput={handleInput}
                onkeydown={handleKeyDown}
                placeholder="Add context"
                rows={1}
                style:max-height="{TEXTAREA_MAX_HEIGHT_PX}px"
              ></textarea>
              {#if onsubmit}
                <button
                  class="eg-circle-btn eg-interactive-scale"
                  onclick={() => onsubmit?.()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5">
                    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              {/if}
            </div>
          </div>
        </div>
      </div>

    <!-- Hovering: tag badge only -->
    {:else}
      <div bind:this={panelEl} class="eg-panel animate-pop-in" style:padding="6px 8px">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="eg-tag"
          class:cursor-pointer={!!filePath}
          onmouseenter={() => isTagHovered = true}
          onmouseleave={() => isTagHovered = false}
          onclick={handleTagClick}
        >
          <span class="eg-tag-name">
            {#if componentName}
              <span class="eg-tag-component">{componentName}</span><span class="eg-tag-suffix">.{tagName}</span>
            {:else}
              <span class="eg-tag-component">{tagName}</span>
            {/if}
          </span>
          {#if filePath}
            <svg
              xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              class="eg-tag-open-icon" class:visible={isTagHovered || false} class:hidden={!isTagHovered}
            >
              <path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /><path d="M11 13l9-9" /><path d="M15 4h5v5" />
            </svg>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
