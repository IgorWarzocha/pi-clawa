import type { WorkerState, WorkerThinkingLevel } from '../clawas/types.js'
import type { ClawaConfig } from '../config.js'

export interface ActionItem {
  label: string
  summary: string
  detailKey: string
  kind: 'bootstrap' | 'create' | 'restart'
}

export interface ManagedWorker {
  id: string
  title: string
  cwd: string
  status: WorkerState['status']
  manualSession: boolean
  autostart: boolean
  model?: string
  thinking?: WorkerThinkingLevel
  currentTask?: string
  lastSummary?: string
  lastError?: string
  sessionFile?: string
}

export interface ClawItem {
  name: string
  summary: string
  detailKey: string
  status: ClawStatus
  config: ClawaConfig
  workers: ManagedWorker[]
}

export type Screen = 'claws' | 'manage' | 'about' | 'help'
export type WorkerAction = 'prompt' | 'steer'

export interface CreateClawRequest {
  purpose: string
}

export interface ClawStatus {
  absPath: string
  exists: boolean
  bootstrapped: boolean
  live: boolean
  socketPath: string | null
}

export type CreateClawAction = (
  request: CreateClawRequest,
) => Promise<{ name: string; path: string; workerId: string }>
