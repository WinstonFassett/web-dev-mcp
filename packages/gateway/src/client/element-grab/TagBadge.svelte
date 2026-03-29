<script lang="ts">
  interface Props {
    componentName?: string
    tagName: string
    isClickable?: boolean
    shrink?: boolean
    forceShowIcon?: boolean
    onclick?: () => void
    onhoverchange?: (hovered: boolean) => void
  }

  let {
    componentName,
    tagName,
    isClickable = false,
    shrink = false,
    forceShowIcon = false,
    onclick,
    onhoverchange,
  }: Props = $props()

  let isHovered = $state(false)
  let showIcon = $derived(isClickable || forceShowIcon)
  let iconVisible = $derived(isHovered || forceShowIcon)
</script>

<div
  class="eg-tag"
  class:shrink-0={shrink}
  class:cursor-pointer={isClickable}
  onmouseenter={() => { isHovered = true; onhoverchange?.(true) }}
  onmouseleave={() => { isHovered = false; onhoverchange?.(false) }}
  onclick={onclick}
>
  <span class="eg-tag-name">
    {#if componentName}
      <span class="eg-tag-component">{componentName}</span><span class="eg-tag-suffix">.{tagName}</span>
    {:else}
      <span class="eg-tag-component">{tagName}</span>
    {/if}
  </span>
  {#if showIcon}
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      class="eg-tag-open-icon"
      class:visible={iconVisible}
      class:hidden={!iconVisible}
    >
      <path d="M12 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      <path d="M11 13l9-9" />
      <path d="M15 4h5v5" />
    </svg>
  {/if}
</div>
