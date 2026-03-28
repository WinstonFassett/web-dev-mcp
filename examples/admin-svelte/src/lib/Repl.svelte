<script lang="ts">
  import { onMount } from 'svelte'
  import { connectGateway, type GatewayConnection } from './gateway'
  import { EditorView, basicSetup } from 'codemirror'
  import { javascript } from '@codemirror/lang-javascript'
  import { oneDark } from '@codemirror/theme-one-dark'
  import { keymap } from '@codemirror/view'

  interface HistoryEntry {
    code: string
    result: string
    isError: boolean
    isScreenshot: boolean
    duration?: number
  }

  let gw: GatewayConnection | null = $state(null)
  let gwError: string | null = $state(null)
  let running = $state(false)
  let history: HistoryEntry[] = $state([])
  let editorEl: HTMLElement | undefined = $state()
  let outputEl: HTMLElement | undefined = $state()
  let editor: EditorView | null = null

  // Connect capnweb
  async function initGw() {
    try {
      gw = await connectGateway()
      gwError = null
    } catch (e: any) {
      gwError = e.message
    }
  }
  initGw()

  $effect(() => {
    return () => gw?.close()
  })

  async function runCode() {
    if (!gw?.connected || running || !editor) return
    const code = editor.state.doc.toString().trim()
    if (!code) return

    running = true
    try {
      const project = gw.stub.getProject()
      // Build an eval function that runs code with document/window from the project stub
      const result = await project.eval(code)
      const parsed = tryParseJson(result)

      history = [...history, {
        code,
        result: parsed ?? result,
        isError: false,
        isScreenshot: isBase64Png(result),
        duration: undefined,
      }]
    } catch (e: any) {
      history = [...history, {
        code,
        result: e.message ?? String(e),
        isError: true,
        isScreenshot: false,
      }]
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

  function isBase64Png(s: string): boolean {
    return typeof s === 'string' && (s.startsWith('data:image/') || s.startsWith('iVBOR'))
  }

  function scrollOutput() {
    requestAnimationFrame(() => {
      if (outputEl) outputEl.scrollTop = outputEl.scrollHeight
    })
  }

  onMount(() => {
    if (!editorEl) return
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
          '&': { fontSize: '13px', maxHeight: '200px' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
      parent: editorEl,
    })
  })
</script>

<div class="flex flex-col gap-4">
  {#if gwError}
    <div class="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      Gateway not reachable: {gwError}
    </div>
  {/if}

  <!-- Editor -->
  <div>
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">Code</h2>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground">Cmd+Enter to run</span>
        <button
          class="px-3 py-1 rounded text-sm bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50"
          onclick={runCode}
          disabled={running || !gw?.connected}
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>
    </div>
    <div
      bind:this={editorEl}
      class="rounded-lg border border-border overflow-hidden"
    ></div>
    <p class="text-xs text-muted-foreground mt-1">
      Runs in browser via <code class="text-foreground">eval()</code>. Access <code class="text-foreground">document</code>, <code class="text-foreground">window</code> directly.
    </p>
  </div>

  <!-- Output -->
  <div>
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">Output</h2>
      <button
        class="text-xs px-2 py-1 rounded bg-muted hover:bg-border text-muted-foreground"
        onclick={() => (history = [])}
      >
        Clear
      </button>
    </div>
    <div
      bind:this={outputEl}
      class="rounded-lg border border-border bg-card p-3 font-mono text-xs max-h-96 overflow-y-auto space-y-3"
    >
      {#if history.length === 0}
        <p class="text-muted-foreground italic">No output yet</p>
      {:else}
        {#each history as entry, i (i)}
          <div class="border-b border-border pb-2 last:border-b-0 last:pb-0">
            <div class="text-muted-foreground mb-1">
              <span class="text-accent">{'>'}</span> {entry.code.length > 80 ? entry.code.slice(0, 80) + '...' : entry.code}
            </div>
            {#if entry.isScreenshot}
              <img
                src={entry.result.startsWith('data:') ? entry.result : `data:image/png;base64,${entry.result}`}
                alt="Screenshot"
                class="max-w-full rounded border border-border"
              />
            {:else}
              <pre class="{entry.isError ? 'text-destructive' : 'text-foreground'} whitespace-pre-wrap">{entry.result}</pre>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
