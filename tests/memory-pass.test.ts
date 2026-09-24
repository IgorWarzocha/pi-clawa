import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import { MemoryPass, shouldRequestMemoryPass } from '../src/memory-pass.js'

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

test('memory pass cannot continue repeatedly until a new session or compaction rearms it', () => {
  const pass = new MemoryPass()
  const highUsage = usage(250_000)
  assert.ok(pass.request(CONFIG, highUsage, 'completed'))
  assert.equal(pass.request(CONFIG, highUsage, 'completed'), undefined)
  pass.rearm()
  assert.ok(pass.request(CONFIG, highUsage, 'completed'))
})

test('aborted and failed runs do not start or consume the memory pass', () => {
  const pass = new MemoryPass()
  const highUsage = usage(250_000)
  assert.equal(pass.request(CONFIG, highUsage, 'aborted'), undefined)
  assert.equal(pass.request(CONFIG, highUsage, 'error'), undefined)
  assert.equal(pass.request(CONFIG, usage(1_000), 'completed'), undefined)
  assert.ok(pass.request(CONFIG, highUsage, 'completed'))
})
