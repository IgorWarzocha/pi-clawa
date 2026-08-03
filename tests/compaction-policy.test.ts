import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import {
  createCompactionPolicyState,
  isUsageBelowCompactionThreshold,
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
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(250_000), false, false), false)
})

test('successful compaction stays disarmed until usage falls below the threshold', () => {
  const state = createCompactionPolicyState()
  state.disarm()

  assert.equal(state.isArmed(), false)
  assert.equal(isUsageBelowCompactionThreshold(CONFIG, usage(250_000)), false)
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(250_000), false, state.isArmed()), false)

  if (isUsageBelowCompactionThreshold(CONFIG, usage(100_000))) state.rearm()
  assert.equal(state.isArmed(), true)
  assert.equal(shouldRequestAutoCompaction(CONFIG, usage(250_000), false, state.isArmed()), true)
})

test('session replacement invalidates an in-flight compaction callback', async () => {
  const state = createCompactionPolicyState()
  const stale = state.beginPending()
  const ready = state.waitUntilReady()

  state.invalidatePending()

  assert.equal(await ready, false)
  assert.equal(state.settleIfOwned(stale, 'succeeded'), false)
  assert.equal(state.hasPending(), false)
  assert.equal(state.isArmed(), true)
})
