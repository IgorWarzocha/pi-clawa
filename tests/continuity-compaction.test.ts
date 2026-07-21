import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeUnknownContextOverflowMessage,
  serializeContinuityConversation,
} from '../src/continuity-compaction.js'

const CLAWA_NOTE_REGEX = /\[Assistant Clawas note to job-a-clawa\]: Check the final layout\./
const CLAWA_RESULT_REGEX = /\[Clawas delivery result\]: Delivered to Jobba\./
const CODING_TOOL_REGEX = /apply_patch|Patch applied/

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

test('continuity keeps Clawas handoffs while dropping ordinary tool chatter', () => {
  const conversation = serializeContinuityConversation([
    {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'tool-1',
          name: 'message_clawa',
          arguments: { claw: 'job-a-clawa', message: 'Check the final layout.' },
        },
        {
          type: 'toolCall',
          id: 'tool-2',
          name: 'apply_patch',
          arguments: { patch: 'large technical diff' },
        },
      ],
    },
    {
      role: 'toolResult',
      toolCallId: 'tool-1',
      toolName: 'message_clawa',
      content: [{ type: 'text', text: 'Delivered to Jobba.' }],
      isError: false,
    },
    {
      role: 'toolResult',
      toolCallId: 'tool-2',
      toolName: 'apply_patch',
      content: [{ type: 'text', text: 'Patch applied' }],
      isError: false,
    },
  ] as never)

  assert.match(conversation, CLAWA_NOTE_REGEX)
  assert.match(conversation, CLAWA_RESULT_REGEX)
  assert.doesNotMatch(conversation, CODING_TOOL_REGEX)
})
