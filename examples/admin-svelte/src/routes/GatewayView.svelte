<script lang="ts">
  import type { Route } from '../lib/data/router'
  import LogStream from '../lib/components/LogStream.svelte'
  let { route }: { route: Route } = $props()
</script>

<LogStream />
