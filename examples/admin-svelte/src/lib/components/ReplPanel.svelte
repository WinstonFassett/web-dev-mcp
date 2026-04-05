<script lang="ts">
  import { onMount } from 'svelte'
  import { evalInBrowser } from '../data/gateway'
  import { getRegistry, type BrowserInfo } from '../data/registry.svelte'
  import type { Route } from '../data/router'
  import { EditorView, basicSetup } from 'codemirror'
  import { javascript } from '@codemirror/lang-javascript'
  import { oneDark } from '@codemirror/theme-one-dark'
  import { keymap } from '@codemirror/view'

  let { route, open = $bindable(false) }: { route: Route; open?: boolean } = $props()

  interface HistoryEntry {
    code: string
    result: string
    isError: boolean
    target: string
    timestamp: number
  }

  let registry = getRegistry()
  let running = $state(false)
  let history: HistoryEntry[] = $state([])
  let editorEl: HTMLElement | undefined = $state()
  let outputEl: HTMLElement | undefined = $state()
  let editor: EditorView | null = null
  let selectedTarget: string = $state('') // serverId for eval targeting

  // Derive available browser targets from current route scope
  let availableTargets: Array<{ label: string; serverId: string; browserId: string }> = $derived.by(() => {
    const targets: Array<{ label: string; serverId: string; browserId: string }> = []

    for (const proj of registry.projects) {
      // Filter to current route scope
      if (route.view === 'project' && proj.projectId !== route.projectId) continue
      if (route.view === 'server' && proj.projectId !== route.projectId) continue
      if (route.view === 'browser' && proj.projectId !== route.projectId) continue

      for (const br of proj.browsers) {
        if (route.view === 'browser' && (br.browserId ?? br.connId) !== route.browserId) continue

        const server = proj.servers.find(s => s.id === br.serverId)
        const port = server?.port ? `:${server.port}` : ''
        const bid = (br.browserId ?? br.connId)?.slice(0, 6) ?? '?'
        targets.push({
          label: `${proj.projectId}${port} / ${bid}`,
          serverId: br.serverId ?? '',
          browserId: br.browserId ?? br.connId,
        })
      }
    }
    return targets
  })

  // Auto-select target when available targets change
  $effect(() => {
    if (availableTargets.length > 0 && !availableTargets.find(t => t.serverId === selectedTarget)) {
      selectedTarget = availableTargets[0].serverId
    }
  })

  async function runCode() {
    if (running || !editor) return
    const code = editor.state.doc.toString().trim()
    if (!code) return

    const target = availableTargets.find(t => t.serverId === selectedTarget)
    if (!target) {
      history.push({
        code,
        result: 'No browser target selected',
        isError: true,
        target: '—',
        timestamp: Date.now(),
      })
      return
    }

    running = true
    try {
      const result = await evalInBrowser(code, target.serverId)
      const formatted = tryParseJson(result) ?? String(result)

      history.push({
        code,
        result: formatted,
        isError: false,
        target: target.label,
        timestamp: Date.now(),
      })
    } catch (e: any) {
      history.push({
        code,
        result: e.message ?? String(e),
        isError: true,
        target: target.label,
        timestamp: Date.now(),
      })
    } finally {
      running = false
      scrollOutput()
    }
  }

  function tryParseJson(s: string): string | null {
    try {
      const obj = JSON.parse(s)
      return JSON.stringify(obj, null, 2)
    } catch {
      return null
    }
  }

  function scrollOutput() {
    requestAnimationFrame(() => {
      if (outputEl) outputEl.scrollTop = outputEl.scrollHeight
    })
  }

  function clearHistory() {
    history.splice(0, history.length)
  }

  onMount(() => {
    // Ctrl+` / Cmd+` to toggle
    function onKey(e: KeyboardEvent) {
      if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        open = !open
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Init CodeMirror when panel opens and element mounts
  $effect(() => {
    if (open && editorEl && !editor) {
      editor = new EditorView({
        doc: 'document.title',
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          keymap.of([{
            key: 'Mod-Enter',
            run: () => { runCode(); return true },
          }]),
          EditorView.theme({
            '&': { fontSize: '12px', maxHeight: '120px' },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-gutters': { display: 'none' },
          }),
        ],
        parent: editorEl,
      })
      editor.focus()
    }
  })
</script>

{#if !open}
  <!-- Collapsed bar -->
  <button
    onclick={() => open = true}
    class="h-7 w-full border-t border-border flex items-center px-3 shrink-0 cursor-pointer hover:bg-muted/50 transition-colors"
  >
    <span class="text-[10px] text-muted-foreground">REPL</span>
    <span class="text-[10px] text-muted-foreground/50 ml-2">Ctrl+`</span>
    {#if history.length > 0}
      <span class="text-[10px] text-muted-foreground/30 ml-auto">{history.length} entries</span>
    {/if}
  </button>
{:else}
  <!-- Expanded panel -->
  <div class="border-t border-border flex flex-col shrink-0" style="height: 280px;">
    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
      <button
        onclick={() => open = false}
        class="text-[10px] text-muted-foreground hover:text-foreground"
        title="Collapse (Ctrl+`)"
      >▾ REPL</button>

      <!-- Target picker -->
      {#if availableTargets.length > 0}
        <select
          bind:value={selectedTarget}
          class="text-[11px] bg-transparent text-muted-foreground border border-border rounded px-1.5 py-0.5 cursor-pointer hover:text-foreground focus:outline-none focus:border-accent max-w-60 truncate"
        >
          {#each availableTargets as t}
            <option value={t.serverId}>{t.label}</option>
          {/each}
        </select>
      {:else}
        <span class="text-[10px] text-muted-foreground/50">No browsers connected</span>
      {/if}

      <div class="flex-1"></div>

      <span class="text-[10px] text-muted-foreground/30">{history.length}</span>
      <button
        onclick={clearHistory}
        class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >Clear</button>
    </div>

    <!-- Output -->
    <div
      bind:this={outputEl}
      class="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px] px-3 py-1"
    >
      {#if history.length === 0}
        <div class="text-muted-foreground/40 py-2">
          Cmd+Enter to run. eval() in browser.
        </div>
      {:else}
        {#each history as entry, i (i)}
          <div class="py-0.5">
            <div class="text-muted-foreground/50">
              <span class="text-accent">{'>'}</span> {entry.code.length > 100 ? entry.code.slice(0, 100) + '...' : entry.code}
            </div>
            <pre class="{entry.isError ? 'text-destructive' : 'text-foreground'} whitespace-pre-wrap pl-3">{entry.result}</pre>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Editor -->
    <div class="border-t border-border shrink-0">
      <div class="flex items-center gap-1 px-2">
        <span class="text-accent text-[11px] shrink-0">{'>'}</span>
        <div
          bind:this={editorEl}
          class="flex-1 overflow-hidden"
        ></div>
        <button
          onclick={runCode}
          disabled={running || availableTargets.length === 0}
          class="text-[10px] px-2 py-0.5 rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-30 shrink-0"
        >
          {running ? '...' : 'Run'}
        </button>
      </div>
    </div>
  </div>
{/if}
