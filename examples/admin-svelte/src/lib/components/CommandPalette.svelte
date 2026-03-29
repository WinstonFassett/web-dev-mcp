<script lang="ts">
  import CommandPaletteLib from 'svelte-command-palette'
  import type { RegistryState } from '../data/registry.svelte'
  import { buildPaletteItems, type CommandPaletteCallbacks } from '../data/palette-items'

  interface Props {
    registry: RegistryState
    callbacks: CommandPaletteCallbacks
  }

  let { registry, callbacks }: Props = $props()

  let items = $derived(buildPaletteItems(registry, callbacks))
</script>

<CommandPaletteLib
  commands={items}
  placeholder="Search actions, navigate..."
  shortcut="$mod+k"
/>
