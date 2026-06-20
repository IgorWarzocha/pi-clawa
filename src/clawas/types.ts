export type WorkerThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type WorkerReportMode = 'auto' | 'explicit' | 'off'

export interface WorkerDefinition {
  id: string
  title: string
  emoji?: string | undefined
  cwd: string
  discordEnabled?: boolean | undefined
  extensions?: string[] | undefined
  enabled: boolean
  autostart: boolean
  startupPrompt?: string | undefined
  model?: string | undefined
  thinking?: WorkerThinkingLevel | undefined
  reportMode?: WorkerReportMode | undefined
}

export interface ClawasConfig {
  workers: WorkerDefinition[]
}

export type WorkerStatus = 'starting' | 'idle' | 'streaming' | 'stopped' | 'error'

export interface WorkerState {
  definition: WorkerDefinition
  cwd: string
  status: WorkerStatus
  manualSession?: boolean | undefined
  sessionFile?: string | undefined
  pid?: number | undefined
  currentTask?: string | undefined
  currentToolName?: string | undefined
  lastSummary: string
  lastError?: string | undefined
  updatedAt: number
}

export interface FeedEvent {
  id: string
  workerId: string
  text: string
  timestamp: number
}

export interface ClawasState {
  workers: WorkerState[]
  events: FeedEvent[]
  nextEventId: number
  daemonStarted: boolean
}
