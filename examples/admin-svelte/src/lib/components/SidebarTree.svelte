<script lang="ts">
  import type { RegistryState, ProjectInfo, ServerInfo, BrowserInfo } from '../data/registry.svelte'
  import type { Route } from '../data/router'
  import { navigatePath } from '../data/router'

  let { registry, route }: { registry: RegistryState; route: Route } = $props()

  function isActive(view: string, projectId?: string, port?: string, browserId?: string): boolean {
    if (route.view !== view) return false
    if (projectId && route.projectId !== projectId) return false
    if (port && route.port !== port) return false
    if (browserId && route.browserId !== browserId) return false
    return true
  }

  let expandedProjects: Set<string> = $state(new Set())

  function toggleExpand(projectId: string) {
    const next = new Set(expandedProjects)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    expandedProjects = next
  }

  function isSingleServer(project: ProjectInfo): boolean {
    return project.servers.length <= 1
  }

  function serverForProject(project: ProjectInfo): ServerInfo | undefined {
    return project.servers[0]
  }

  function browsersForServer(server: ServerInfo, browsers: BrowserInfo[]): BrowserInfo[] {
    return browsers.filter(b => b.serverId === server.id)
  }

  function browserLabel(b: BrowserInfo): string {
    return b.browserId?.slice(0, 6) ?? b.connId.slice(0, 6)
  }
</script>

<nav class="text-xs space-y-0.5">
  <!-- Gateway -->
  <button
    onclick={() => navigatePath('#/gateway')}
    class="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors truncate
      {isActive('gateway') ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
  >
    __gateway
  </button>

  {#if registry.projects.length === 0}
    <p class="text-[10px] text-muted-foreground/50 px-2 pt-2">No projects connected</p>
  {/if}

  {#each registry.projects as project}
    {@const single = isSingleServer(project)}
    {@const server = serverForProject(project)}
    {@const expanded = expandedProjects.has(project.projectId)}
    {@const browsers = project.browsers}

    {#if single && server}
      <!-- Single-server project: flat display -->
      <div class="space-y-0.5">
        <button
          onclick={() => navigatePath(`#/project/${project.projectId}`)}
          class="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors truncate
            {isActive('project', project.projectId) || isActive('server', project.projectId) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
        >
          <span>{project.name}</span>
          <span class="text-muted-foreground/60 ml-1">:{server.port}</span>
          {#if browsers.length > 0}
            <span class="text-muted-foreground/40 ml-1">({browsers.length})</span>
          {/if}
        </button>

        <!-- Browsers under single-server project -->
        {#each browsers as browser}
          <button
            onclick={() => navigatePath(`#/project/${project.projectId}/${server.port}/${browser.connId}`)}
            class="w-full text-left pl-5 pr-2 py-0.5 rounded hover:bg-muted transition-colors truncate text-[11px]
              {isActive('browser', project.projectId, String(server.port), browser.connId) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground/70'}"
          >
            {browserLabel(browser)}
          </button>
        {/each}
      </div>

    {:else}
      <!-- Multi-server project: expandable -->
      <div class="space-y-0.5">
        <button
          onclick={() => { toggleExpand(project.projectId); navigatePath(`#/project/${project.projectId}`) }}
          class="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors truncate
            {isActive('project', project.projectId) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
        >
          <span class="mr-1">{expanded ? '▾' : '▸'}</span>
          <span>{project.name}</span>
          <span class="text-muted-foreground/40 ml-1">({project.servers.length} servers)</span>
        </button>

        {#if expanded}
          {#each project.servers as srv}
            {@const srvBrowsers = browsersForServer(srv, registry.browsers)}
            <button
              onclick={() => navigatePath(`#/project/${project.projectId}/${srv.port}`)}
              class="w-full text-left pl-4 pr-2 py-0.5 rounded hover:bg-muted transition-colors truncate text-[11px]
                {isActive('server', project.projectId, String(srv.port)) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground/70'}"
            >
              :{srv.port}
              {#if srvBrowsers.length > 0}
                <span class="text-muted-foreground/40 ml-1">({srvBrowsers.length})</span>
              {/if}
            </button>

            {#each srvBrowsers as browser}
              <button
                onclick={() => navigatePath(`#/project/${project.projectId}/${srv.port}/${browser.connId}`)}
                class="w-full text-left pl-7 pr-2 py-0.5 rounded hover:bg-muted transition-colors truncate text-[11px]
                  {isActive('browser', project.projectId, String(srv.port), browser.connId) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground/70'}"
              >
                {browserLabel(browser)}
              </button>
            {/each}
          {/each}
        {/if}
      </div>
    {/if}
  {/each}
</nav>
