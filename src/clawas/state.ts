import { resolve } from 'node:path'
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
      cwd: resolve(rootCwd, definition.cwd),
      status: 'stopped',
      lastSummary: 'not started yet',
      updatedAt: now,
    })),
    events: [],
    nextEventId: 1,
    connected: false,
  }
}

export function getWorkerState(state: ClawasState, workerId: string): WorkerState {
  const worker = state.workers.find((entry) => entry.definition.id === workerId)
  if (!worker) {
    throw new Error(`Unknown Clawas worker: ${workerId}`)
  }
  return worker
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
