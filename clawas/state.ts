import { CLAWAS_EVENT_LIMIT } from './config.js'
import type { ClawasState, FeedEvent, WorkerDefinition, WorkerState } from './types.js'

export function createInitialState(
  workers: readonly WorkerDefinition[],
  rootCwd: string,
  now: number,
): ClawasState {
  return {
    workers: workers.map((definition) => ({
      definition,
      cwd: resolveWorkerCwd(rootCwd, definition.cwd),
      status: 'stopped',
      lastSummary: 'not started yet',
      updatedAt: now,
    })),
    events: [],
    nextEventId: 1,
    daemonStarted: false,
  }
}

export function resolveWorkerCwd(rootCwd: string, configuredCwd: string): string {
  if (configuredCwd.startsWith('/')) {
    return configuredCwd
  }

  return `${rootCwd}/${configuredCwd}`.replace(/\/+/g, '/')
}

export function getWorkerState(state: ClawasState, workerId: string): WorkerState {
  const worker = state.workers.find((entry) => entry.definition.id === workerId)
  if (!worker) {
    throw new Error(`Unknown Clawas worker: ${workerId}`)
  }
  return worker
}

export function patchWorkerState(
  state: ClawasState,
  workerId: string,
  patch: Partial<Omit<WorkerState, 'definition' | 'cwd'>>,
  now: number,
): void {
  const worker = getWorkerState(state, workerId)
  Object.assign(worker, patch, { updatedAt: now })
}

export function pushEvent(
  state: ClawasState,
  workerId: string,
  text: string,
  timestamp: number,
): void {
  const event: FeedEvent = {
    id: `event-${state.nextEventId}`,
    workerId,
    text,
    timestamp,
  }

  state.events = [...state.events, event].slice(-CLAWAS_EVENT_LIMIT)
  state.nextEventId += 1
}
