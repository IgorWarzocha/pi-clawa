import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseClawasCommsCommand,
  parseLastMessageData,
  parseSessionStatusData,
} from './protocol.js'

const BOOLEAN_STATUS_ERROR_PATTERN = /requires boolean/u

test('Clawas comms rejects malformed commands before delivery', () => {
  assert.deepEqual(parseClawasCommsCommand({ type: 'send' }), {
    error: 'send.message must be a non-empty string',
  })
  assert.deepEqual(parseClawasCommsCommand({ type: 'send', message: 'hello', mode: 'prompt' }), {
    error: 'mode must be one of: steer, followUp',
  })
  assert.deepEqual(parseClawasCommsCommand({ type: 'unknown' }), {
    error: 'unsupported command type',
  })
})

test('Clawas comms normalizes valid commands and validates response payloads', () => {
  const parsed = parseClawasCommsCommand({
    type: 'send',
    id: 'request-1',
    message: 'hello',
    sender: { workerId: 'main-claw' },
    intent: 'handoff',
  })
  assert.ok('value' in parsed)
  assert.equal(parsed.value.type, 'send')

  assert.deepEqual(parseSessionStatusData({ isIdle: true, hasPendingMessages: false }), {
    isIdle: true,
    hasPendingMessages: false,
  })
  assert.deepEqual(
    parseLastMessageData({
      message: { role: 'assistant', content: 'done', timestamp: 42 },
    }),
    { role: 'assistant', content: 'done', timestamp: 42, error: undefined },
  )
  assert.throws(
    () => parseSessionStatusData({ isIdle: 'yes', hasPendingMessages: false }),
    BOOLEAN_STATUS_ERROR_PATTERN,
  )
})
