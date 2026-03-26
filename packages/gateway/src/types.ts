export interface GatewayOptions {
  target?: string
  port?: number
  network?: boolean
  react?: boolean
  https?: boolean
  cert?: string
  key?: string
  autoRegister?: boolean
  logDir?: string
  maxFileSizeMb?: number
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
}

export interface ErrorPayload {
  type: 'console-error' | 'unhandled-exception' | 'unhandled-rejection'
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
  initiator: 'fetch' | 'xhr'
}

export interface SessionInfo {
  sessionId: string
  logDir: string
  files: Record<string, string>
  channels: string[]
  serverUrl: string
  mcpUrl: string
  targetUrl: string | null
  startedAt: number
}

export interface BuildStatus {
  last_update_at: number | null
  last_error_at: number | null
  last_error: string | undefined
  update_count: number
  error_count: number
  pending: boolean
}

export interface DiagnosticSummary {
  error_count: number
  warning_count: number
  failed_requests: number
  has_unhandled_rejections: boolean
}

export interface DiagnosticsResult {
  build: BuildStatus
  logs: {
    console: HarnessEvent[]
    errors: HarnessEvent[]
    network: HarnessEvent[]
  }
  summary: DiagnosticSummary
  checkpoint_ts: number | null
}
