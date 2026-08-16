import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import { shouldRequestMemoryPass } from '../src/memory-pass.js'

const CONFIG = { enabled: true, triggerPercent: 90 }

function usage(tokens: number | null, contextWindow = 272_000): ContextUsage {
  return {
    tokens,
    contextWindow,
    percent: tokens === null ? null : (tokens / contextWindow) * 100,
  }
}

test('memory pass follows the active model window without owning compaction', () => {
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(244_799), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(244_800), true), true)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(115_200, 128_000), true), true)
  assert.equal(shouldRequestMemoryPass({ ...CONFIG, enabled: false }, usage(250_000), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(null), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(250_000), false), false)
})
