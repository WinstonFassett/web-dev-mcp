<script lang="ts">
  import type { Route } from '../lib/data/router'
  import { getRegistry } from '../lib/data/registry.svelte'
  import LogStream from '../lib/components/LogStream.svelte'
  let { route }: { route: Route } = $props()

  let registry = getRegistry()
  let serverId = $derived(
    registry.projects.find(p => p.projectId === route.projectId)?.servers[0]?.id
  )
</script>

<LogStream historyServerId={serverId} />
