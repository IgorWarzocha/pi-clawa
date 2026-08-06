import assert from 'node:assert/strict'
import test from 'node:test'
import { startClawasDaemon } from './runtime.js'

const START_FAILURE_PATTERN = /partial start failed/u

test('failed Clawas daemon starts are disposed before the error escapes', async () => {
  let disposeCount = 0
  const daemon = {
    start: async () => {
      throw new Error('partial start failed')
    },
    dispose: async () => {
      disposeCount += 1
    },
  }

  await assert.rejects(() => startClawasDaemon(daemon), START_FAILURE_PATTERN)
  assert.equal(disposeCount, 1)
})
