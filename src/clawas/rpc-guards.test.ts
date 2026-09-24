import assert from 'node:assert/strict'
import test from 'node:test'
import { readRpcAssistantText, readRpcSessionState } from './rpc-guards.js'

const invalidSessionFile = /sessionFile/
const invalidState = /get_state/
const invalidText = /text/

test('consumed RPC data normalizes empty sessions and rejects malformed fields', () => {
  assert.deepEqual(readRpcSessionState({ sessionFile: '/tmp/session', isStreaming: false }), {
    sessionFile: '/tmp/session',
  })
  assert.deepEqual(readRpcSessionState({}), {})
  assert.throws(() => readRpcSessionState({ sessionFile: null }), invalidSessionFile)
  assert.throws(() => readRpcSessionState(null), invalidState)
  assert.throws(() => readRpcSessionState([]), invalidState)
  assert.equal(readRpcAssistantText({ text: null }), null)
  assert.equal(readRpcAssistantText({ text: 'reply' }), 'reply')
  assert.equal(readRpcAssistantText({}), null)
  assert.throws(() => readRpcAssistantText({ text: 42 }), invalidText)
  assert.throws(() => readRpcAssistantText([]), invalidText)
})
