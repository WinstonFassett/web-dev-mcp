<script lang="ts">
  import { ARROW_HEIGHT_PX, ARROW_MIN_SIZE_PX, ARROW_MAX_LABEL_WIDTH_RATIO } from './constants'

  interface Props {
    color?: string
    position?: 'top' | 'bottom'
    leftPercent?: number
    leftOffsetPx?: number
    labelWidth?: number
  }

  let {
    color = 'white',
    position = 'top',
    leftPercent = 50,
    leftOffsetPx = 0,
    labelWidth = 0,
  }: Props = $props()

  let arrowSize = $derived(
    labelWidth <= 0
      ? ARROW_HEIGHT_PX
      : Math.max(ARROW_MIN_SIZE_PX, Math.min(ARROW_HEIGHT_PX, labelWidth * ARROW_MAX_LABEL_WIDTH_RATIO))
  )
  let isBottom = $derived(position === 'bottom')
</script>

<div
  class="eg-arrow"
  style:left="calc({leftPercent}% + {leftOffsetPx}px)"
  style:top={isBottom ? '0' : undefined}
  style:bottom={isBottom ? undefined : '0'}
  style:transform={isBottom ? 'translateX(-50%) translateY(-100%)' : 'translateX(-50%) translateY(100%)'}
  style:border-left="{arrowSize}px solid transparent"
  style:border-right="{arrowSize}px solid transparent"
  style:border-bottom={isBottom ? `${arrowSize}px solid ${color}` : undefined}
  style:border-top={isBottom ? undefined : `${arrowSize}px solid ${color}`}
></div>
