import { patchWorkerState, pushEvent } from './state.js'
import type { ClawasState } from './types.js'

export function resetStateForRestart(state: ClawasState, timestamp: number): void {
  state.events = []
  state.nextEventId = 1

  for (const worker of state.workers) {
    worker.status = 'stopped'
    worker.manualSession = undefined
    worker.pid = undefined
    worker.currentTask = undefined
    worker.currentToolName = undefined
    worker.lastError = undefined
    worker.lastSummary = 'restarting daemon'
    worker.updatedAt = timestamp
  }
}

export function markWorkerDetachedState(
  state: ClawasState,
  workerId: string,
  label: string,
  timestamp: number,
): void {
  patchWorkerState(
    state,
    workerId,
    {
      status: 'stopped',
      manualSession: true,
      pid: undefined,
      currentTask: label,
      currentToolName: undefined,
      lastError: undefined,
      lastSummary: label,
    },
    timestamp,
  )
  pushEvent(state, workerId, `${workerId} opened as ${label}`, timestamp)
}

export function clearManualSessionState(
  state: ClawasState,
  workerId: string,
  label: string,
  timestamp: number,
): void {
  patchWorkerState(
    state,
    workerId,
    {
      status: 'stopped',
      manualSession: false,
      pid: undefined,
      currentTask: undefined,
      currentToolName: undefined,
      lastError: undefined,
      lastSummary: label,
    },
    timestamp,
  )
  pushEvent(state, workerId, `${workerId} ${label}`, timestamp)
}
