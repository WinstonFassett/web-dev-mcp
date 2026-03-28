<script lang="ts">
  import type { ServerInfo, BrowserInfo } from './api'

  let {
    server,
    browsers,
    onBack,
  }: {
    server: ServerInfo
    browsers: BrowserInfo[]
    onBack: () => void
  } = $props()

  const GATEWAY = 'http://localhost:3333'

  function ago(ts: number): string {
    const ms = Date.now() - ts
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
    return `${Math.round(ms / 3_600_000)}h ago`
  }

  // Filtered browsers for this server
  let projectBrowsers = $derived(browsers.filter(b => b.serverId === server.id))

  // SSE log stream filtered for this server's browsers
  interface LogEvent {
    type: string
    channel?: string
    payload?: any
    browserId?: string
  }

  let logs: LogEvent[] = $state([])
  let logContainer: HTMLElement | undefined = $state()
  let autoScroll = $state(true)
  const MAX_LOGS = 500

  function levelClass(level?: string): string {
    switch (level) {
      case 'error': return 'text-destructive'
      case 'warn': return 'text-warning'
      case 'info': return 'text-accent'
      default: return 'text-foreground'
    }
  }

  function channelBadge(channel?: string): string {
    switch (channel) {
      case 'console': return 'bg-accent/20 text-accent'
      case 'error': return 'bg-destructive/20 text-destructive'
      case 'server-console': return 'bg-success/20 text-success'
      case 'network': return 'bg-warning/20 text-warning'
      default: return 'bg-muted text-muted-foreground'
    }
  }

  function formatPayload(event: LogEvent): string {
    const p = event.payload
    if (!p) return JSON.stringify(event)
    if (p.args) return p.args.join(' ')
    if (p.message) return p.message
    return JSON.stringify(p)
  }

  function addLog(event: LogEvent) {
    logs = [...logs.slice(-MAX_LOGS + 1), event]
    if (autoScroll && logContainer) {
      requestAnimationFrame(() => {
        logContainer!.scrollTop = logContainer!.scrollHeight
      })
    }
  }

  // Get browser IDs belonging to this server to filter SSE events
  let projectBrowserIds = $derived(new Set(projectBrowsers.map(b => b.browserId).filter(Boolean)))

  let eventSource: EventSource | null = null

  $effect(() => {
    eventSource = new EventSource(`${GATEWAY}/__admin/events`)
    eventSource.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data)
        // Only show events from this project's browsers
        if (data.browserId && !projectBrowserIds.has(data.browserId)) return
        addLog({ type: 'log', ...data })
      } catch {}
    })
    return () => eventSource?.close()
  })
</script>

<div>
  <!-- Back button + header -->
  <div class="flex items-center gap-3 mb-4">
    <button
      class="px-2 py-1 rounded text-sm bg-muted hover:bg-border text-muted-foreground"
      onclick={onBack}
    >
      &larr; Back
    </button>
    <h2 class="text-lg font-semibold">
      {server.type}
      <span class="text-muted-foreground font-mono text-sm ml-1">{server.id}</span>
    </h2>
  </div>

  <!-- Server info -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
    <div class="rounded-lg border border-border bg-card p-3">
      <div class="text-xs text-muted-foreground">Type</div>
      <div class="text-sm font-medium">{server.type}</div>
    </div>
    <div class="rounded-lg border border-border bg-card p-3">
      <div class="text-xs text-muted-foreground">Port</div>
      <div class="text-sm font-medium">{server.port}</div>
    </div>
    <div class="rounded-lg border border-border bg-card p-3">
      <div class="text-xs text-muted-foreground">PID</div>
      <div class="text-sm font-medium font-mono">{server.pid}</div>
    </div>
    <div class="rounded-lg border border-border bg-card p-3">
      <div class="text-xs text-muted-foreground">Browsers</div>
      <div class="text-sm font-medium">{projectBrowsers.length}</div>
    </div>
  </div>

  <div class="rounded-lg border border-border bg-card p-3 mb-6">
    <div class="text-xs text-muted-foreground mb-1">Directory</div>
    <div class="text-sm font-mono">{server.directory}</div>
  </div>

  <!-- Project browsers -->
  <section class="mb-6">
    <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Browsers</h3>
    {#if projectBrowsers.length === 0}
      <p class="text-sm text-muted-foreground italic">No browsers for this project</p>
    {:else}
      <div class="rounded-lg border border-border overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">ID</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Connected</th>
            </tr>
          </thead>
          <tbody>
            {#each projectBrowsers as b}
              <tr class="border-b border-border last:border-b-0">
                <td class="px-3 py-2 font-mono text-xs">{(b.browserId || b.connId).slice(0, 16)}</td>
                <td class="px-3 py-2 text-muted-foreground">{ago(b.connectedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Filtered logs -->
  <section>
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">Project Logs</h3>
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" bind:checked={autoScroll} class="rounded" />
          Auto-scroll
        </label>
        <button
          class="text-xs px-2 py-1 rounded bg-muted hover:bg-border text-muted-foreground"
          onclick={() => (logs = [])}
        >
          Clear
        </button>
      </div>
    </div>
    <div
      bind:this={logContainer}
      class="rounded-lg border border-border bg-card p-2 font-mono text-xs max-h-80 overflow-y-auto"
    >
      {#if logs.length === 0}
        <p class="text-muted-foreground italic py-2 px-1">Listening for project events...</p>
      {:else}
        {#each logs as event, i (i)}
          <div class="py-0.5 flex gap-2 hover:bg-muted/30 px-1 rounded">
            {#if event.channel}
              <span class="shrink-0 px-1.5 py-0 rounded text-[10px] font-medium {channelBadge(event.channel)}">
                {event.channel}
              </span>
            {/if}
            <span class={levelClass(event.payload?.level)}>
              {formatPayload(event)}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  </section>
</div>
