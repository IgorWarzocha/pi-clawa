import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createHowabandaMonitorState,
  findMonitorWorker,
  getActiveMonitorWorker,
  getMonitorWorkerBySlot,
  selectMonitorWorker,
  selectRelativeMonitorWorker,
} from './monitor-state.js'
import type { HowabandaState, WorkerState } from './types.js'

function worker(id: string, title: string): WorkerState {
  return {
    definition: {
      id,
      title,
      cwd: id,
      enabled: true,
      autostart: false,
    },
    cwd: id,
    status: 'idle',
    lastSummary: 'ready',
    updatedAt: 1,
  }
}

function state(): HowabandaState {
  return {
    workers: [worker('tech-a-clawa', 'Tech A Clawa'), worker('job-a-clawa', 'Job A Clawa')],
    events: [],
    nextEventId: 1,
    daemonStarted: true,
  }
}

test('monitor state cycles active workers', () => {
  const monitor = createHowabandaMonitorState()
  const next = selectRelativeMonitorWorker(state(), monitor, 1)
  assert.equal(getActiveMonitorWorker(state(), next)?.definition.id, 'job-a-clawa')

  const wrapped = selectRelativeMonitorWorker(state(), next, 1)
  assert.equal(getActiveMonitorWorker(state(), wrapped)?.definition.id, 'tech-a-clawa')
})

test('monitor state resolves slots and names', () => {
  const current = state()
  const monitor = selectMonitorWorker(current, createHowabandaMonitorState(), 'job-a-clawa')

  assert.equal(getActiveMonitorWorker(current, monitor)?.definition.id, 'job-a-clawa')
  assert.equal(getMonitorWorkerBySlot(current, 1)?.definition.id, 'tech-a-clawa')
  assert.equal(findMonitorWorker(current, 'Tech A Clawa')?.definition.id, 'tech-a-clawa')
})
