export type WorkerThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type WorkerReportMode = 'auto' | 'explicit' | 'off'

export type WorkerPromptProfile = 'auto' | 'gpt' | 'glm' | 'discord'

export interface WorkerDefinition {
  id: string
  title: string
  emoji?: string
  cwd: string
  discordEnabled?: boolean
  extensions?: string[]
  enabled: boolean
  autostart: boolean
  startupPrompt?: string
  model?: string
  thinking?: WorkerThinkingLevel
  reportMode?: WorkerReportMode
  promptProfile?: WorkerPromptProfile
}

export interface ClawasConfig {
  workers: WorkerDefinition[]
}

export type WorkerStatus = 'starting' | 'idle' | 'streaming' | 'stopped' | 'error'

export interface WorkerState {
  definition: WorkerDefinition
  cwd: string
  status: WorkerStatus
  manualSession?: boolean
  sessionFile?: string
  pid?: number
  currentTask?: string
  currentToolName?: string
  lastSummary: string
  lastError?: string
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
