export interface ViteLiveDevMcpOptions {
  mcpPath?: string
  network?: boolean
  react?: boolean
  networkOptions?: {
    excludePatterns?: string[]
    captureRequestBody?: boolean
    captureResponseBody?: boolean
  }
  reactOptions?: {
    mode?: 'on-demand' | 'commit'
    maxDepth?: number
    includeProps?: boolean
    includeState?: boolean
    excludeComponents?: string[]
    commitThrottleMs?: number
    commitMaxEventsPerMin?: number
  }
  logDir?: string
  maxFileSizeMb?: number
  autoRegister?:
    | boolean
    | {
        claude?: boolean
        cursor?: boolean
        windsurf?: boolean
      }
  notifications?: boolean
  printUrl?: boolean
}

export interface HarnessEvent {
  id: number
  ts: number
  channel: string
  payload: unknown
}

export interface ConsolePayload {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug'
  args: string[]
  stack?: string
  file?: string
  line?: number
}

export interface HmrPayload {
  type: 'update' | 'full-reload' | 'error' | 'prune'
  modules?: string[]
  error?: string
  duration?: number
}

export interface ErrorPayload {
  type: 'console-error' | 'unhandled-exception' | 'unhandled-rejection' | 'hmr-error'
  message: string
  stack?: string
  file?: string
  line?: number
}

export interface NetworkPayload {
  method: string
  url: string
  status: number
  duration: number
  requestSize?: number
  responseSize?: number
  initiator: 'fetch' | 'xhr'
}

export interface SessionInfo {
  sessionId: string
  projectRoot: string
  logDir: string
  files: Record<string, string>
  channels: string[]
  serverUrl: string
  mcpUrl: string
  startedAt: number
  viteVersion: string
  pluginVersion: string
}

export interface ComponentNode {
  name: string
  depth: number
  props?: Record<string, string>
  state?: Record<string, string>
  children: ComponentNode[]
}
