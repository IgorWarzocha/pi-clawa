import assert from 'node:assert/strict'
import test from 'node:test'
import { parseClawasCommsCommand } from './protocol.js'

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
  for (const input of [
    { type: 'context', operation: 'bind', sessionId: '../elsewhere', binding: {} },
    {
      type: 'context',
      operation: 'execute',
      request: { sessionId: 'family', agentName: '/root', namespace: 'shell', params: {} },
      visited: [],
    },
  ]) {
    assert.ok('error' in parseClawasCommsCommand(input))
  }
})
