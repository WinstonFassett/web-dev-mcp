<script lang="ts">
  import { getLogEntries, clearEntries, type LogEntry } from '../data/logs.svelte'

  interface LogFilter {
    browserId?: string
    serverId?: string
  }

  let { filter = {} }: { filter?: LogFilter } = $props()

  // Channel tabs
  const CHANNELS = [
    { id: 'all', label: 'All' },
    { id: 'console', label: 'Console' },
    { id: 'errors', label: 'Errors' },
    { id: 'network', label: 'Network' },
    { id: 'server-console', label: 'Server' },
    { id: 'dev-events', label: 'Build' },
  ]

  // Severity levels
  const LEVELS = [
    { id: 'error', label: 'E', color: 'text-destructive' },
    { id: 'warn', label: 'W', color: 'text-warning' },
    { id: 'info', label: 'I', color: 'text-info' },
    { id: 'log', label: 'L', color: 'text-muted-foreground' },
    { id: 'debug', label: 'D', color: 'text-muted-foreground/60' },
  ]

  let activeChannel: string = $state('all')
  let activeLevels: Set<string> = $state(new Set(LEVELS.map(l => l.id)))
  let autoScroll: boolean = $state(true)
  let scrollContainer: HTMLDivElement | undefined = $state()

  // All entries from the global stream
  let allEntries = getLogEntries()

  // Client-side filtered view
  let filteredEntries: LogEntry[] = $derived.by(() => {
    let result = allEntries

    // Scope filter (browser/server)
    if (filter.browserId) {
      result = result.filter(e => e.browserId === filter.browserId || e.connId === filter.browserId)
    }
    if (filter.serverId) {
      result = result.filter(e => e.serverId === filter.serverId)
    }

    // Channel filter
    if (activeChannel !== 'all') {
      result = result.filter(e => e.channel === activeChannel)
    }

    // Level filter
    if (activeLevels.size < LEVELS.length) {
      result = result.filter(e => {
        const level = e.payload?.level ?? 'log'
        return activeLevels.has(level)
      })
    }

    return result
  })

  // Auto-scroll on new entries
  $effect(() => {
    const _len = filteredEntries.length
    if (autoScroll && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
      })
    }
  })

  function onScroll() {
    if (!scrollContainer) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    autoScroll = scrollHeight - scrollTop - clientHeight < 50
  }

  function jumpToBottom() {
    autoScroll = true
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
  }

  function toggleLevel(id: string) {
    const next = new Set(activeLevels)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    activeLevels = next
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function levelColor(entry: LogEntry): string {
    const level = entry.payload?.level ?? entry.channel
    if (level === 'error' || entry.channel === 'errors') return 'text-destructive'
    if (level === 'warn') return 'text-warning'
    if (level === 'info') return 'text-info'
    if (level === 'debug') return 'text-muted-foreground/60'
    return 'text-foreground'
  }

  function levelBadge(entry: LogEntry): string {
    const level = entry.payload?.level ?? ''
    if (level === 'error' || entry.channel === 'errors') return 'err'
    if (level === 'warn') return 'wrn'
    if (level === 'info') return 'inf'
    if (level === 'debug') return 'dbg'
    return 'log'
  }

  function entryMessage(entry: LogEntry): string {
    const p = entry.payload
    if (!p) return ''
    if (typeof p === 'string') return p
    if (p.message) return String(p.message)
    if (p.args?.length) return p.args.map(String).join(' ')
    if (p.text) return String(p.text)
    if (p.url) return `${p.method ?? 'GET'} ${p.url} ${p.status ?? ''}`
    return JSON.stringify(p)
  }
</script>

<div class="flex flex-col h-full overflow-hidden relative">
  <!-- Channel tabs + severity toggles -->
  <div class="flex items-center gap-1 px-3 py-1 border-b border-border shrink-0">
    <!-- Channel tabs -->
    <div class="flex items-center gap-0.5">
      {#each CHANNELS as ch}
        <button
          onclick={() => activeChannel = ch.id}
          class="px-2 py-0.5 rounded text-[11px] transition-colors
            {activeChannel === ch.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}"
        >
          {ch.label}
        </button>
      {/each}
    </div>

    <span class="w-px h-4 bg-border mx-1"></span>

    <!-- Severity toggles -->
    <div class="flex items-center gap-0.5">
      {#each LEVELS as lv}
        <button
          onclick={() => toggleLevel(lv.id)}
          class="w-6 h-5 flex items-center justify-center rounded text-[10px] font-medium transition-colors
            {activeLevels.has(lv.id) ? lv.color + ' bg-muted' : 'text-muted-foreground/40 line-through'}"
          title={lv.id}
        >
          {lv.label}
        </button>
      {/each}
    </div>

    <div class="flex-1"></div>

    <!-- Count + clear -->
    <span class="text-[10px] text-muted-foreground/50">{filteredEntries.length}</span>
    <button
      onclick={() => clearEntries()}
      class="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-1"
      title="Clear all logs"
    >
      Clear
    </button>
  </div>

  <!-- Log entries -->
  <div
    bind:this={scrollContainer}
    onscroll={onScroll}
    class="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px]"
  >
    {#if filteredEntries.length === 0}
      <div class="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
        Waiting for logs...
      </div>
    {:else}
      {#each filteredEntries as entry, i (i)}
        <div class="flex gap-2 px-3 py-px hover:bg-muted/30 {entry.channel === 'errors' || entry.payload?.level === 'error' ? 'bg-destructive/5' : ''}">
          <span class="text-muted-foreground/50 shrink-0 w-16">{formatTime(entry.timestamp)}</span>
          <span class="shrink-0 w-7 {levelColor(entry)}">{levelBadge(entry)}</span>
          <span class="shrink-0 w-20 text-muted-foreground/40 truncate">{entry.channel}</span>
          <span class="flex-1 truncate {levelColor(entry)}">{entryMessage(entry)}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Jump to bottom -->
  {#if !autoScroll}
    <button
      onclick={jumpToBottom}
      class="absolute bottom-2 right-4 px-2 py-1 rounded bg-accent text-accent-foreground text-[10px] shadow-lg"
    >
      Jump to bottom
    </button>
  {/if}
</div>
