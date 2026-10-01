import assert from 'node:assert/strict'
import test from 'node:test'
import { stopAllWorkers } from './daemon-shutdown.js'
import { ClawasRpcWorker } from './rpc-worker.js'
import { createInitialState } from './state.js'

const definition = { id: 'worker', title: 'Worker', cwd: '.', enabled: true, autostart: true }

test('shutdown stops registered workers without waiting for their startup RPCs', {
  timeout: 1_000,
}, async (t) => {
  let finishStart!: () => void
  const start = new Promise<void>((resolve) => {
    finishStart = resolve
  })
  t.after(() => finishStart())
  let stops = 0
  const worker = new ClawasRpcWorker({ definition, cwd: '.', extensionPaths: [] })
  worker.stop = async () => {
    stops += 1
    finishStart()
  }
  const workers = new Map([['worker', worker]])
  await stopAllWorkers({
    state: createInitialState([definition], '.', 0),
    workers,
    workerStarts: new Map([['worker', start]]),
    streamBuffers: new Map(),
    getNow: () => 0,
  })
  assert.equal(stops, 1)
  assert.equal(workers.size, 0)
})
