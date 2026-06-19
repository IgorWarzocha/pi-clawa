import type { HowabandaState, WorkerState } from './types.js'

export interface HowabandaMonitorState {
  activeWorkerIndex: number
  folded: boolean
}

export function createHowabandaMonitorState(): HowabandaMonitorState {
  return { activeWorkerIndex: 0, folded: false }
}

export function clampMonitorWorkerIndex(index: number, workerCount: number): number {
  if (workerCount <= 0) return 0
  if (!Number.isSafeInteger(index)) return 0
  return Math.min(Math.max(0, index), workerCount - 1)
}

export function getActiveMonitorWorker(
  state: HowabandaState | null | undefined,
  monitor: HowabandaMonitorState,
): WorkerState | undefined {
  const workers = state?.workers ?? []
  if (workers.length === 0) return undefined
  return workers[clampMonitorWorkerIndex(monitor.activeWorkerIndex, workers.length)]
}

export function getMonitorWorkerBySlot(
  state: HowabandaState | null | undefined,
  slot: number,
): WorkerState | undefined {
  if (!Number.isSafeInteger(slot) || slot < 1) return undefined
  return state?.workers[slot - 1]
}

export function findMonitorWorker(
  state: HowabandaState | null | undefined,
  target: string,
): WorkerState | undefined {
  const normalized = target.trim().toLowerCase()
  if (!normalized) return undefined
  return state?.workers.find((worker) => {
    return (
      worker.definition.id.toLowerCase() === normalized ||
      worker.definition.title.toLowerCase() === normalized
    )
  })
}

export function selectRelativeMonitorWorker(
  state: HowabandaState | null | undefined,
  monitor: HowabandaMonitorState,
  direction: number,
): HowabandaMonitorState {
  const workerCount = state?.workers.length ?? 0
  if (workerCount === 0) return { ...monitor, activeWorkerIndex: 0 }
  const current = clampMonitorWorkerIndex(monitor.activeWorkerIndex, workerCount)
  const next = (current + direction + workerCount) % workerCount
  return { ...monitor, activeWorkerIndex: next, folded: false }
}

export function selectMonitorWorker(
  state: HowabandaState | null | undefined,
  monitor: HowabandaMonitorState,
  workerId: string,
): HowabandaMonitorState {
  const index = (state?.workers ?? []).findIndex((worker) => worker.definition.id === workerId)
  if (index < 0) return monitor
  return { ...monitor, activeWorkerIndex: index }
}
