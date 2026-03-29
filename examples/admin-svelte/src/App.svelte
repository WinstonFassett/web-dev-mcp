<script lang="ts">
  import { initTheme, toggleTheme } from './lib/data/theme'
  import { parseHash, navigate, type Route } from './lib/data/router'
  import { getRegistry, refreshRegistry } from './lib/data/registry.svelte'
  import { onConnectionChange } from './lib/data/gateway'
  import { startLogging, stopLogging } from './lib/data/logs.svelte'
  import SidebarTree from './lib/components/SidebarTree.svelte'
  import GatewayView from './routes/GatewayView.svelte'
  import ProjectView from './routes/ProjectView.svelte'
  import ServerView from './routes/ServerView.svelte'
  import BrowserView from './routes/BrowserView.svelte'

  let theme = $state(initTheme())
  let route: Route = $state(parseHash(location.hash))
  let registry = getRegistry()
  let gwConnected = $state(false)

  // Listen for hash changes
  $effect(() => {
    const onHashChange = () => {
      route = parseHash(location.hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  })

  // Track gateway connection status
  $effect(() => {
    return onConnectionChange((connected) => {
      gwConnected = connected
      if (connected) refreshRegistry()
    })
  })

  // Init: fetch registry + start log stream
  $effect(() => {
    refreshRegistry()
    startLogging()
    return () => stopLogging()
  })

  // Auto-select: prefer deepest leaf available, gateway is last resort
  $effect(() => {
    // Only auto-select when on gateway or initial load
    if (route.view !== 'gateway' && location.hash && location.hash !== '#/' && location.hash !== '#') return
    if (registry.projects.length === 0) {
      // No projects — fall back to gateway
      if (!location.hash || location.hash === '#/' || location.hash === '#') {
        location.hash = '#/gateway'
      }
      return
    }

    // Pick first project (or only project)
    const proj = registry.projects[0]
    const srv = proj.servers[0]
    if (!srv) {
      navigate({ view: 'project', projectId: proj.projectId })
      return
    }

    // If any browser exists, go to deepest leaf
    if (proj.browsers.length > 0) {
      const br = proj.browsers[0]
      navigate({ view: 'browser', projectId: proj.projectId, port: String(srv.port), browserId: br.browserId ?? br.connId })
    } else {
      navigate({ view: 'project', projectId: proj.projectId })
    }
  })

  function onToggleTheme() {
    theme = toggleTheme(theme)
  }
</script>

<div class="h-screen flex flex-col overflow-hidden">
  <!-- Top bar -->
  <header class="h-8 flex items-center justify-between px-3 border-b border-border shrink-0">
    <div class="flex items-center gap-2">
      <a href="#/gateway" class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        web-dev-mcp
      </a>
      <span class="text-xs text-muted-foreground/50">/</span>
      <span class="text-xs text-foreground">
        {#if route.view === 'gateway'}
          __gateway
        {:else if route.view === 'project'}
          {route.projectId}
        {:else if route.view === 'server'}
          <a href="#/project/{route.projectId}" class="hover:text-accent transition-colors">{route.projectId}</a>
          <span class="text-muted-foreground/50 mx-0.5">/</span>
          :{route.port}
        {:else if route.view === 'browser'}
          <a href="#/project/{route.projectId}" class="hover:text-accent transition-colors">{route.projectId}</a>
          <span class="text-muted-foreground/50 mx-0.5">/</span>
          <a href="#/project/{route.projectId}/{route.port}" class="hover:text-accent transition-colors">:{route.port}</a>
          <span class="text-muted-foreground/50 mx-0.5">/</span>
          {route.browserId?.slice(0, 6)}
        {/if}
      </span>
    </div>
    <div class="flex items-center gap-2">
      <button
        onclick={onToggleTheme}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Toggle theme"
      >
        {theme === 'dark' ? '☀' : '◑'}
      </button>
    </div>
  </header>

  <!-- Main area: sidebar + content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-44 border-r border-border shrink-0 overflow-y-auto p-2">
      <SidebarTree {registry} {route} />
    </aside>

    <!-- Content -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <!-- Route content -->
      <div class="flex-1 overflow-y-auto">
        {#if route.view === 'gateway'}
          <GatewayView {route} />
        {:else if route.view === 'project'}
          <ProjectView {route} />
        {:else if route.view === 'server'}
          <ServerView {route} />
        {:else if route.view === 'browser'}
          <BrowserView {route} />
        {/if}
      </div>

      <!-- REPL bar (collapsed) -->
      <div class="h-7 border-t border-border flex items-center px-3 shrink-0 cursor-pointer hover:bg-muted/50 transition-colors">
        <span class="text-[10px] text-muted-foreground">REPL</span>
        <span class="text-[10px] text-muted-foreground/50 ml-2">Ctrl+`</span>
      </div>
    </main>
  </div>

  <!-- Status footer -->
  <footer class="h-6 border-t border-border flex items-center px-3 shrink-0 text-[10px] text-muted-foreground gap-3">
    <span class="flex items-center gap-1">
      <span class="w-1.5 h-1.5 rounded-full {gwConnected ? 'bg-success' : 'bg-destructive'}"></span>
      {gwConnected ? 'connected' : 'disconnected'}
    </span>
    <span>{registry.projects.length} project{registry.projects.length !== 1 ? 's' : ''}</span>
    <span>{registry.browsers.length} browser{registry.browsers.length !== 1 ? 's' : ''}</span>
    {#if registry.uptimeMs > 0}
      <span>uptime {Math.floor(registry.uptimeMs / 60000)}m</span>
    {/if}
  </footer>
</div>
