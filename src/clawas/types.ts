import type { ClawaWorkerConfig, ClawaWorkerThinkingLevel } from '../config.js'
import type { PanelHandle } from './panel-host.js'

export type WorkerThinkingLevel = ClawaWorkerThinkingLevel
export type WorkerDefinition = ClawaWorkerConfig

export interface ClawasConfig {
  workers: WorkerDefinition[]
}

type WorkerStatus = 'starting' | 'idle' | 'streaming' | 'stopped' | 'error'

export interface WorkerState {
  definition: WorkerDefinition
  cwd: string
  status: WorkerStatus
  panel?: PanelHandle | undefined
  sessionFile?: string | undefined
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
  connected: boolean
}
