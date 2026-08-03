import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCompactionSidecarState,
  parseSidecarModelRef,
  parseStagedMemories,
  type StagedMemory,
} from '../src/compaction-sidecar.js'

const MATCH = { parentEntryId: 'entry-42', reason: 'threshold' as const }
const MISSING_MEMORIES_PATTERN = /returned no memories block/
const INVALID_MODEL_PATTERN = /Invalid Clawa compaction sidecar model/

test('sidecar model refs preserve provider-specific slashes in model ids', () => {
  assert.deepEqual(parseSidecarModelRef('openrouter/anthropic/claude-sonnet'), {
    provider: 'openrouter',
    modelId: 'anthropic/claude-sonnet',
  })
  assert.throws(() => parseSidecarModelRef('missing-provider'), INVALID_MODEL_PATTERN)
})

test('sidecar parsing stages only three normalized memories', () => {
  assert.deepEqual(
    parseStagedMemories(`<memories>
- [Human, Taste, taste] Keep the home prose direct.
* A warm correction without tags.
[direction] Preserve Pi as the history owner.
[ignored] This fourth line is over the limit.
</memories>`),
    [
      { tags: ['human', 'taste'], content: 'Keep the home prose direct.' },
      { tags: [], content: 'A warm correction without tags.' },
      { tags: ['direction'], content: 'Preserve Pi as the history owner.' },
    ],
  )
  assert.deepEqual(parseStagedMemories('<memories>NONE</memories>'), [])
  assert.throws(() => parseStagedMemories('NONE'), MISSING_MEMORIES_PATTERN)
})

test('a staged sidecar is consumed only by its matching canonical compaction', async () => {
  const state = createCompactionSidecarState<StagedMemory[]>()
  const source = new AbortController()
  let finish: ((memories: StagedMemory[]) => void) | undefined
  const result = new Promise<StagedMemory[]>((resolve) => {
    finish = resolve
  })

  state.begin({ match: MATCH, signal: source.signal, run: () => result })
  assert.equal(state.hasPending(), true)
  assert.equal(
    await state.consume({ parentEntryId: 'another-entry', reason: 'threshold' }),
    undefined,
  )
  assert.equal(state.hasPending(), true)

  const consuming = state.consume(MATCH)
  finish?.([{ tags: ['human'], content: 'A durable correction.' }])
  assert.deepEqual(await consuming, [{ tags: ['human'], content: 'A durable correction.' }])
  assert.equal(state.hasPending(), false)
})

test('invalidation aborts detached work and blocks stale consumption', async () => {
  const state = createCompactionSidecarState<StagedMemory[]>()
  const source = new AbortController()
  let observedSignal: AbortSignal | undefined
  let finish: ((memories: StagedMemory[]) => void) | undefined

  state.begin({
    match: MATCH,
    signal: source.signal,
    run: (signal) => {
      observedSignal = signal
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  await Promise.resolve()
  state.invalidate()

  assert.equal(observedSignal?.aborted, true)
  finish?.([{ tags: [], content: 'stale' }])
  assert.equal(await state.consume(MATCH), undefined)
  assert.equal(state.hasPending(), false)
})

test('the Pi compaction abort signal cancels the sidecar before canonical success', async () => {
  const state = createCompactionSidecarState<StagedMemory[]>()
  const source = new AbortController()
  let reportedErrors = 0

  state.begin({
    match: MATCH,
    signal: source.signal,
    run: (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    onError: () => {
      reportedErrors++
    },
  })
  await Promise.resolve()
  source.abort(new Error('canonical compaction aborted'))

  assert.equal(await state.consume(MATCH), undefined)
  assert.equal(reportedErrors, 0)
  assert.equal(state.hasPending(), false)
})

test('canonical success detaches the Pi abort signal while the staged result finishes', async () => {
  const state = createCompactionSidecarState<StagedMemory[]>()
  const source = new AbortController()
  let finish: ((memories: StagedMemory[]) => void) | undefined

  state.begin({
    match: MATCH,
    signal: source.signal,
    run: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  })
  await Promise.resolve()
  const consuming = state.consume(MATCH)
  source.abort(new Error('canonical controller cleaned up'))
  finish?.([{ tags: [], content: 'committed after success' }])

  assert.deepEqual(await consuming, [{ tags: [], content: 'committed after success' }])
})

test('detached failures remain contained even if failure reporting throws', async () => {
  const state = createCompactionSidecarState<StagedMemory[]>()

  state.begin({
    match: MATCH,
    signal: new AbortController().signal,
    run: async () => {
      throw new Error('sidecar failed')
    },
    onError: () => {
      throw new Error('notifier failed')
    },
  })

  assert.equal(await state.consume(MATCH), undefined)
  assert.equal(state.hasPending(), false)
})
