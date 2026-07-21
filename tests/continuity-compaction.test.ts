import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeUnknownContextOverflowMessage } from '../src/continuity-compaction.js'

test('normalizes provider context-window markers for Pi overflow recovery', () => {
  const normalized = normalizeUnknownContextOverflowMessage({
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'Unhandled stop reason: model_context_window_exceeded',
  })

  assert.equal(
    normalized?.errorMessage,
    'context_length_exceeded: Unhandled stop reason: model_context_window_exceeded',
  )
})

test('does not rewrite unrelated model errors', () => {
  const normalized = normalizeUnknownContextOverflowMessage({
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'rate limit exceeded',
  })

  assert.equal(normalized, undefined)
})
