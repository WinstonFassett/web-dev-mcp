<script lang="ts">
  import { initTheme, toggleTheme } from './lib/theme'
  import Dashboard from './lib/Dashboard.svelte'
  import Repl from './lib/Repl.svelte'

  let theme = $state(initTheme())
  let activeTab: 'dashboard' | 'repl' = $state('dashboard')
</script>

<div class="min-h-screen flex flex-col">
  <!-- Header -->
  <header class="border-b border-border px-4 py-3 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <h1 class="text-lg font-semibold">web-dev-mcp gateway</h1>
      <nav class="flex gap-1">
        <button
          class="px-3 py-1 rounded text-sm {activeTab === 'dashboard'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
          onclick={() => (activeTab = 'dashboard')}
        >
          Dashboard
        </button>
        <button
          class="px-3 py-1 rounded text-sm {activeTab === 'repl'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
          onclick={() => (activeTab = 'repl')}
        >
          REPL
        </button>
      </nav>
    </div>

    <button
      class="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
      onclick={() => (theme = toggleTheme(theme))}
      aria-label="Toggle theme"
    >
      {#if theme === 'dark'}
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      {/if}
    </button>
  </header>

  <!-- Content -->
  <main class="flex-1 p-4">
    {#if activeTab === 'dashboard'}
      <Dashboard />
    {:else}
      <Repl />
    {/if}
  </main>
</div>
