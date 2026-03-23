import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, truncateSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionInfo, ViteLiveDevMcpOptions } from './types.js'

const PLUGIN_VERSION = '0.1.0'

export function computeSessionId(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 6)
}

export function getLogDir(projectRoot: string, options: ViteLiveDevMcpOptions): string {
  if (options.logDir) return options.logDir
  return join(tmpdir(), `vite-harness-${computeSessionId(projectRoot)}`)
}

export interface SessionState {
  info: SessionInfo
  logDir: string
  files: Record<string, string>
  channels: string[]
  startedAt: number
  checkpointTs: number | null
}

export function initSession(
  projectRoot: string,
  options: ViteLiveDevMcpOptions,
  viteVersion: string,
  serverUrl: string,
  mcpPath: string,
): SessionState {
  const sessionId = computeSessionId(projectRoot)
  const logDir = getLogDir(projectRoot, options)
  const mcpUrl = `${serverUrl}${mcpPath}/sse`

  mkdirSync(logDir, { recursive: true })

  const channels: string[] = ['console', 'hmr', 'errors']
  if (options.network) channels.push('network')
  if (options.react) channels.push('react')

  const files: Record<string, string> = {}
  for (const ch of channels) {
    files[ch] = join(logDir, `${ch}.ndjson`)
  }

  // Truncate all NDJSON files on session start
  for (const filePath of Object.values(files)) {
    writeFileSync(filePath, '')
  }

  const info: SessionInfo = {
    sessionId,
    projectRoot,
    logDir,
    files,
    channels,
    serverUrl,
    mcpUrl,
    startedAt: Date.now(),
    viteVersion,
    pluginVersion: PLUGIN_VERSION,
  }

  writeFileSync(join(logDir, 'session.json'), JSON.stringify(info, null, 2) + '\n')

  return { info, logDir, files, channels, startedAt: info.startedAt, checkpointTs: null }
}

export function truncateChannelFiles(files: Record<string, string>, channels?: string[]): Record<string, number> {
  const countsBefore: Record<string, number> = {}
  const toTruncate = channels ?? Object.keys(files)

  for (const ch of toTruncate) {
    const filePath = files[ch]
    if (!filePath) continue

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8')
      countsBefore[ch] = content.trim() ? content.trim().split('\n').length : 0
      truncateSync(filePath, 0)
    } else {
      countsBefore[ch] = 0
      writeFileSync(filePath, '')
    }
  }

  return countsBefore
}
