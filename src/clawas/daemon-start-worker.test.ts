import assert from 'node:assert/strict'
import test from 'node:test'
import { coalesceWorkerStart } from './daemon-start-worker.js'

test('concurrent requests share one worker start', async () => {
  const starts = new Map<string, Promise<void>>()
  let calls = 0
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const start = async () => {
    calls += 1
    await blocked
  }

  const first = coalesceWorkerStart(starts, 'discord-clawa', start)
  const second = coalesceWorkerStart(starts, 'discord-clawa', start)
  await Promise.resolve()

  assert.equal(calls, 1)
  assert.equal(starts.size, 1)

  release()
  await Promise.all([first, second])
  assert.equal(starts.size, 0)
})

test('a completed worker start does not block the next launch', async () => {
  const starts = new Map<string, Promise<void>>()
  let calls = 0
  const start = async () => {
    calls += 1
  }

  await coalesceWorkerStart(starts, 'discord-clawa', start)
  await coalesceWorkerStart(starts, 'discord-clawa', start)

  assert.equal(calls, 2)
})
