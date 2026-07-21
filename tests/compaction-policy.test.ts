import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import {
  createCompactionPolicyState,
  shouldRequestAutoCompaction,
} from '../src/compaction-policy.js'

const CONFIG = { auto: true, triggerPercent: 80 }

function usage(tokens: number | null, contextWindow = 272_000): ContextUsage {
  return {
    tokens,
    contextWindow,
    percent: tokens === null ? null : (tokens / contextWindow) * 100,
  }
}

test('Clawa auto-compaction follows each model context window', () => {
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(217_599), false), false)
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(217_600), false), true)
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(102_400, 128_000), false), true)
  assert.equal(
    shouldRequestAutoCompaction({ ...CONFIG, auto: false }, usage(250_000), false),
    false,
  )
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(null), false), false)
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(250_000), true), false)
})

test('session replacement invalidates an in-flight compaction callback', async () => {
  const state = createCompactionPolicyState()
  const stale = state.beginPending()
  const ready = state.waitUntilReady()

  state.invalidatePending()

  assert.equal(await ready, false)
  assert.equal(state.clearIfOwned(stale), false)
  assert.equal(state.hasPending(), false)
})
