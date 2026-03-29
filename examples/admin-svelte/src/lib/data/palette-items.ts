/**
 * Build command palette items from registry state + nav history.
 * Returns an action[] compatible with svelte-command-palette.
 */
import { defineActions } from 'svelte-command-palette'
import type { action } from 'svelte-command-palette'
import type { RegistryState, ProjectInfo, ServerInfo, BrowserInfo } from './registry.svelte'
import { navigatePath } from './router'
import { getRecentHashes } from './nav-history'
import { clearEntries } from './logs.svelte'

// ── Navigation items ──────────────────────────────────────────

function serverForProject(project: ProjectInfo): ServerInfo | undefined {
  return project.servers[0]
}

function browsersForServer(server: ServerInfo, browsers: BrowserInfo[]): BrowserInfo[] {
  return browsers.filter(b => b.serverId === server.id)
}

function navItems(registry: RegistryState): action[] {
  const items: action[] = []

  // Gateway (always)
  items.push({
    actionId: 'nav-gateway',
    title: 'Gateway',
    description: `${registry.projects.length} projects · ${registry.browsers.length} browsers`,
    group: 'Navigate',
    keywords: ['gateway', '__gateway', 'home'],
    onRun: () => navigatePath('#/gateway'),
  })

  for (const project of registry.projects) {
    const isSingle = project.servers.length <= 1
    const srv = serverForProject(project)
    const port = srv ? `:${srv.port}` : ''
    const browserCount = project.browsers.length

    // Project item
    items.push({
      actionId: `nav-project-${project.projectId}`,
      title: `${project.name} ${port}`,
      description: isSingle
        ? `${browserCount} browser${browserCount !== 1 ? 's' : ''}`
        : `${project.servers.length} servers · ${browserCount} browsers`,
      group: 'Navigate',
      keywords: [project.projectId, project.name, port, srv?.type ?? ''].filter(Boolean),
      onRun: () => navigatePath(`#/project/${project.projectId}`),
    })

    // Server items (only for multi-server projects)
    if (!isSingle) {
      for (const server of project.servers) {
        const srvBrowsers = browsersForServer(server, project.browsers)
        items.push({
          actionId: `nav-server-${project.projectId}-${server.port}`,
          title: `${project.name} :${server.port}`,
          description: `${server.type} · ${srvBrowsers.length} browser${srvBrowsers.length !== 1 ? 's' : ''}`,
          group: 'Navigate',
          keywords: [project.name, String(server.port), server.type],
          onRun: () => navigatePath(`#/project/${project.projectId}/${server.port}`),
        })
      }
    }

    // Browser items
    for (const browser of project.browsers) {
      const bServer = project.servers.find(s => s.id === browser.serverId)
      const bPort = bServer ? `:${bServer.port}` : ''
      const browserId = browser.browserId ?? browser.connId
      items.push({
        actionId: `nav-browser-${browserId}`,
        title: `${project.name} ${bPort}`,
        subTitle: browserId.slice(0, 8),
        group: 'Navigate',
        keywords: [project.name, bPort, browserId, 'browser'],
        onRun: () => navigatePath(`#/project/${project.projectId}/${bServer?.port ?? ''}/${browserId}`),
      })
    }
  }

  return items
}

// ── Recent items (from nav history) ───────────────────────────

function recentItems(registry: RegistryState): action[] {
  const hashes = getRecentHashes()
  const allNav = navItems(registry)
  const items: action[] = []
  let count = 0

  for (const hash of hashes) {
    if (count >= 5) break
    // Find matching nav item by checking if its onRun would navigate to this hash
    const match = allNav.find(item => {
      // Match by reconstructing the expected hash from actionId
      if (item.actionId === 'nav-gateway') return hash === '#/gateway'
      const id = String(item.actionId)
      if (id.startsWith('nav-browser-')) {
        const browserId = id.replace('nav-browser-', '')
        return hash.endsWith(`/${browserId}`)
      }
      if (id.startsWith('nav-server-')) {
        const [, , projectId, port] = id.split('-')
        return hash === `#/project/${projectId}/${port}`
      }
      if (id.startsWith('nav-project-')) {
        const projectId = id.replace('nav-project-', '')
        return hash === `#/project/${projectId}`
      }
      return false
    })
    if (match) {
      items.push({
        ...match,
        actionId: `recent-${match.actionId}`,
        group: 'Recent',
      })
      count++
    }
  }
  return items
}

// ── Active items (by registry activity) ───────────────────────

function activeItems(registry: RegistryState): action[] {
  // Browsers sorted by most recently connected
  const sorted = [...registry.browsers].sort((a, b) => b.connectedAt - a.connectedAt)
  const items: action[] = []

  for (const browser of sorted.slice(0, 5)) {
    const server = registry.servers.find(s => s.id === browser.serverId)
    const project = registry.projects.find(p =>
      p.servers.some(s => s.id === browser.serverId)
    )
    if (!project || !server) continue

    const browserId = browser.browserId ?? browser.connId
    const ago = formatAgo(browser.connectedAt)
    items.push({
      actionId: `active-${browserId}`,
      title: `${project.name} :${server.port}`,
      subTitle: `${browserId.slice(0, 8)} · connected ${ago}`,
      group: 'Active',
      keywords: [project.name, String(server.port), browserId, 'active', 'connected'],
      onRun: () => navigatePath(`#/project/${project.projectId}/${server.port}/${browserId}`),
    })
  }
  return items
}

function formatAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

// ── Command items ─────────────────────────────────────────────

export interface CommandPaletteCallbacks {
  onToggleTheme: () => void
  onToggleRepl: () => void
}

function commandItems(callbacks: CommandPaletteCallbacks): action[] {
  return [
    {
      actionId: 'cmd-toggle-theme',
      title: 'Toggle theme',
      description: 'Switch between light and dark mode',
      group: 'Commands',
      keywords: ['theme', 'dark', 'light', 'mode'],
      onRun: () => callbacks.onToggleTheme(),
    },
    {
      actionId: 'cmd-toggle-repl',
      title: 'Toggle REPL',
      description: 'Open or close the REPL panel',
      shortcut: 'Control+`',
      group: 'Commands',
      keywords: ['repl', 'console', 'eval'],
      onRun: () => callbacks.onToggleRepl(),
    },
    {
      actionId: 'cmd-clear-logs',
      title: 'Clear log stream',
      description: 'Clear all visible log entries',
      group: 'Commands',
      keywords: ['clear', 'logs', 'clean'],
      onRun: () => clearEntries(),
    },
  ]
}

// ── Public API ─────────────────────────────────────────────────

export function buildPaletteItems(
  registry: RegistryState,
  callbacks: CommandPaletteCallbacks,
): action[] {
  return defineActions([
    ...recentItems(registry),
    ...activeItems(registry),
    ...navItems(registry),
    ...commandItems(callbacks),
  ])
}
