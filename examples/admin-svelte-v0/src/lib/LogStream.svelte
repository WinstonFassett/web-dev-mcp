<script lang="ts">
  import { getGateway } from './gateway'

  interface LogEvent {
    type: string
    channel?: string
    payload?: any
    connId?: string
    browserId?: string
    serverId?: string
  }

  let logs: LogEvent[] = $state([])
  let streaming = $state(false)
  let error: string | null = $state(null)
  let logContainer: HTMLElement | undefined = $state()
  let autoScroll = $state(true)
  const MAX_LOGS = 500

  function levelClass(level?: string): string {
    switch (level) {
      case 'error': return 'text-destructive'
      case 'warn': return 'text-warning'
      case 'info': return 'text-accent'
      case 'debug': return 'text-muted-foreground'
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
    if (event.type === 'connect') return `Browser connected: ${event.browserId || event.connId}`
    if (event.type === 'disconnect') return `Browser disconnected: ${event.browserId || event.connId}`
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

  async function startStream() {
    streaming = true
    error = null
    try {
      const gw = await getGateway()
      const stream: ReadableStream = await gw.stub.subscribeEvents()
      console.log('[admin] capnweb log stream connected')
      const reader = stream.getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        addLog(value as LogEvent)
      }
    } catch (e: any) {
      if (e.message !== 'WebSocket closed') {
        error = e.message
        console.error('[admin] log stream error:', e.message)
      }
    } finally {
      streaming = false
    }
  }

  startStream()
</script>

<section>
  <div class="flex items-center justify-between mb-2">
    <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">
      Live Logs
      {#if streaming}
        <span class="inline-block w-2 h-2 rounded-full bg-success ml-2 animate-pulse"></span>
      {/if}
    </h2>
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

  {#if error}
    <p class="text-sm text-destructive">{error}</p>
  {/if}

  <div
    bind:this={logContainer}
    class="rounded-lg border border-border bg-card p-2 font-mono text-xs max-h-80 overflow-y-auto"
  >
    {#if logs.length === 0}
      <p class="text-muted-foreground italic py-2 px-1">
        {#if streaming}
          Listening for events...
        {:else}
          No events yet
        {/if}
      </p>
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
