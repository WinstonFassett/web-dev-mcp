<script lang="ts">
  import { connectGateway, type GatewayConnection } from './gateway'
  import { fetchAdminData, type AdminData, type BrowserInfo } from './api'
  import StatCard from './StatCard.svelte'
  import LogStream from './LogStream.svelte'

  let data: AdminData | null = $state(null)
  let error: string | null = $state(null)
  let gw: GatewayConnection | null = $state(null)
  let source: 'capnweb' | 'fetch' | null = $state(null)

  function formatUptime(ms: number): string {
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
    return `${Math.round(ms / 3_600_000)}h`
  }

  function ago(ts: number): string {
    return formatUptime(Date.now() - ts) + ' ago'
  }

  // Try capnweb first, fall back to fetch polling
  async function refreshViaCapnweb(conn: GatewayConnection) {
    try {
      const [browserCount, browsers, projects] = await Promise.all([
        conn.stub.getBrowserCount(),
        conn.stub.getBrowserList(),
        conn.stub.listProjects(),
      ])
      data = {
        uptime_ms: data?.uptime_ms ?? 0, // capnweb doesn't expose uptime yet
        mode: projects.length > 0 ? 'hybrid' : 'hub',
        browsers: browsers as BrowserInfo[],
        servers: [], // capnweb listProjects returns IDs, not full server info
        mcp_sessions: 0, // not exposed via capnweb yet
      }
      // Supplement with fetch for fields capnweb doesn't have
      try {
        const full = await fetchAdminData()
        data = { ...data, uptime_ms: full.uptime_ms, servers: full.servers, mcp_sessions: full.mcp_sessions }
      } catch { /* capnweb data is enough */ }
      error = null
      source = 'capnweb'
    } catch (e: any) {
      error = e.message
    }
  }

  async function refreshViaFetch() {
    try {
      data = await fetchAdminData()
      error = null
      source = 'fetch'
    } catch (e: any) {
      error = e.message
    }
  }

  let interval: ReturnType<typeof setInterval> | null = null

  async function init() {
    // Try capnweb connection
    try {
      gw = await connectGateway()
      console.log('[admin] capnweb connected')
      await refreshViaCapnweb(gw)
      interval = setInterval(() => {
        if (gw?.connected) refreshViaCapnweb(gw)
        else refreshViaFetch()
      }, 3000)
    } catch {
      // Fall back to fetch polling
      console.log('[admin] capnweb unavailable, using fetch')
      await refreshViaFetch()
      interval = setInterval(refreshViaFetch, 5000)
    }
  }

  init()

  $effect(() => {
    return () => {
      if (interval) clearInterval(interval)
      gw?.close()
    }
  })
</script>

{#if error}
  <div class="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
    Gateway not reachable: {error}
  </div>
{/if}

{#if data}
  <!-- Stats -->
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-6">
    <StatCard label="Uptime" value={formatUptime(data.uptime_ms)} />
    <StatCard label="Mode" value={data.mode} />
    <StatCard label="Browsers" value={data.browsers.length} />
    <StatCard label="Servers" value={data.servers.length} />
    <StatCard label="MCP Sessions" value={data.mcp_sessions} />
  </div>

  {#if source}
    <p class="text-xs text-muted-foreground mb-4">Data via {source}</p>
  {/if}

  <!-- Browsers -->
  <section class="mb-6">
    <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Connected Browsers</h2>
    {#if data.browsers.length === 0}
      <p class="text-sm text-muted-foreground italic">No browsers connected</p>
    {:else}
      <div class="rounded-lg border border-border overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">ID</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Server</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Connected</th>
            </tr>
          </thead>
          <tbody>
            {#each data.browsers as b}
              <tr class="border-b border-border last:border-b-0 hover:bg-muted/30">
                <td class="px-3 py-2 font-mono text-xs">{(b.browserId || b.connId).slice(0, 12)}</td>
                <td class="px-3 py-2 font-mono text-xs">{b.serverId || '-'}</td>
                <td class="px-3 py-2 text-muted-foreground">{ago(b.connectedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Servers -->
  <section>
    <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Registered Servers</h2>
    {#if data.servers.length === 0}
      <p class="text-sm text-muted-foreground italic">No servers registered</p>
    {:else}
      <div class="rounded-lg border border-border overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">ID</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Port</th>
              <th class="text-left px-3 py-2 font-medium text-muted-foreground">Directory</th>
            </tr>
          </thead>
          <tbody>
            {#each data.servers as s}
              <tr class="border-b border-border last:border-b-0 hover:bg-muted/30">
                <td class="px-3 py-2 font-mono text-xs">{s.id}</td>
                <td class="px-3 py-2">{s.type}</td>
                <td class="px-3 py-2">{s.port}</td>
                <td class="px-3 py-2 font-mono text-xs text-muted-foreground">{s.directory}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Live Logs -->
  <section class="mt-6">
    <LogStream />
  </section>
{:else if !error}
  <p class="text-muted-foreground">Loading...</p>
{/if}
