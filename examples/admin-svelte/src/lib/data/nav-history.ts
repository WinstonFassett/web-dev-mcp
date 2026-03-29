/** Navigation history — tracks visited routes in localStorage for Cmd+K recents */

const STORAGE_KEY = 'web-dev-mcp-nav-history'
const MAX_ENTRIES = 20

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function save(entries: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

/** Record a navigation. Moves hash to front, deduplicates, caps at MAX_ENTRIES. */
export function trackNavigation(hash: string) {
  if (!hash || hash === '#/' || hash === '#') return
  const entries = load().filter(h => h !== hash)
  entries.unshift(hash)
  save(entries.slice(0, MAX_ENTRIES))
}

/** Get recent route hashes (most recent first). */
export function getRecentHashes(): string[] {
  return load()
}
