import type { WorkerState, WorkerThinkingLevel } from '../clawas/types.js'
import type { ClawaConfig } from '../config.js'
import type { PulseDefinition } from '../pulses/definitions.js'

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
  model?: string | undefined
  thinking?: WorkerThinkingLevel | undefined
  currentTask?: string | undefined
  lastSummary?: string | undefined
  lastError?: string | undefined
  sessionFile?: string | undefined
}

export interface ClawItem {
  name: string
  summary: string
  detailKey: string
  status: ClawStatus
  config: ClawaConfig
  workers: ManagedWorker[]
}

export interface PulseItem {
  key: string
  title: string
  summary: string
  detailKey: string
  definition: PulseDefinition
}

export type Screen = 'claws' | 'manage' | 'pulses' | 'about' | 'help'
export type WorkerAction = 'prompt' | 'steer' | 'jump'

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
