import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CompactOptions,
  ContextUsage,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import {
  createCompactionPolicyState,
  registerCompactionPolicy,
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

test('every Clawa session compacts quietly at the settled safe point', async () => {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>()
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
      handlers.set(event, handler)
    },
  } as unknown as ExtensionAPI
  const compactCalls: CompactOptions[] = []
  const ctx = {
    hasUI: false,
    getContextUsage: () => usage(220_000),
    compact: (options: CompactOptions) => compactCalls.push(options),
  } as unknown as ExtensionContext

  const state = registerCompactionPolicy(pi, () => CONFIG)
  const settled = handlers.get('agent_settled')
  assert.ok(settled)

  const settling = settled({}, ctx)
  await Promise.resolve()
  const duplicate = settled({}, ctx)
  assert.equal(compactCalls.length, 1)
  assert.equal(state.hasPending(), true)

  compactCalls[0]?.onComplete?.({
    summary: 'continuity',
    firstKeptEntryId: 'entry-1',
    tokensBefore: 220_000,
  })
  await Promise.all([settling, duplicate])
  assert.equal(state.hasPending(), false)
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
