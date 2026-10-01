import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import { MemoryPass } from '../src/memory-pass.js'

const CONFIG = { enabled: true, triggerPercent: 90 }

function usage(tokens: number | null, contextWindow = 272_000): ContextUsage {
  return {
    tokens,
    contextWindow,
    percent: tokens === null ? null : (tokens / contextWindow) * 100,
  }
}

test('memory pass cannot continue repeatedly until a new session or compaction rearms it', () => {
  const pass = new MemoryPass()
  const highUsage = usage(250_000)
  assert.ok(pass.request(CONFIG, highUsage, 'completed'))
  assert.equal(pass.request(CONFIG, highUsage, 'completed'), undefined)
  pass.rearm()
  assert.ok(pass.request(CONFIG, highUsage, 'completed'))
})
