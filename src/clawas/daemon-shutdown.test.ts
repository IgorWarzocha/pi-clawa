import assert from 'node:assert/strict'
import test from 'node:test'
import { stopAllWorkers } from './daemon-shutdown.js'
import { ClawasRpcWorker } from './rpc-worker.js'
import { createInitialState } from './state.js'

const definition = { id: 'worker', title: 'Worker', cwd: '.', enabled: true, autostart: true }

test('shutdown also stops workers registered by in-flight starts', async () => {
  const workers = new Map<string, ClawasRpcWorker>()
  const workerStarts = new Map<string, Promise<void>>()
  let finishStart!: () => void
  let stops = 0
  const worker = new ClawasRpcWorker({ definition, cwd: '.', extensionPaths: [] })
  worker.stop = async () => {
    stops += 1
  }
  workerStarts.set(
    'worker',
    new Promise<void>((resolve) => {
      finishStart = () => {
        workers.set('worker', worker)
        resolve()
      }
    }),
  )
  const streamBuffers = new Map([['worker', 'partial']])
  const shutdown = stopAllWorkers({
    state: createInitialState([definition], '.', 0),
    workers,
    workerStarts,
    streamBuffers,
    getNow: () => 0,
  })
  await Promise.resolve()
  assert.equal(stops, 0)
  finishStart()
  await shutdown
  assert.equal(stops, 1)
  assert.equal(workers.size, 0)
  assert.equal(streamBuffers.size, 0)
})

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
