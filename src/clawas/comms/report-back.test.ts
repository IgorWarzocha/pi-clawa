import assert from 'node:assert/strict'
import test from 'node:test'
import { getLastAssistantMessage, getLastMailMessageTimestamp } from './message-extract.ts'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.ts'
import {
  shouldReportClawaFinalToMain,
  shouldSkipAutoMainClawStatusRelay,
} from './report-back-helpers.ts'

function ctxWithBranch(branch: unknown[]) {
  return { sessionManager: { getBranch: () => branch } } as never
}

test('last assistant extraction skips tool-call drafts but keeps the final reply', () => {
  assert.deepEqual(
    getLastAssistantMessage(
      ctxWithBranch([
        { type: 'message', message: { role: 'assistant', content: 'first', timestamp: 1 } },
        {
          type: 'message',
          message: { role: 'assistant', content: [{ type: 'toolCall' }], timestamp: 2 },
        },
        {
          type: 'message',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'finished' }],
            timestamp: 3,
          },
        },
      ]),
    ),
    { role: 'assistant', content: 'finished', timestamp: 3 },
  )
})

test('same-turn handoff suppresses automatic report, but earlier handoff does not', () => {
  assert.equal(
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery: { route: 'main-claw', content: 'handoff', timestamp: 20 },
      lastMailTimestamp: 10,
    }),
    true,
  )
  assert.equal(
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery: { route: 'main-claw', content: 'old handoff', timestamp: 5 },
      lastMailTimestamp: 10,
    }),
    false,
  )
})

test('mail timestamp survives persisted entry formats', () => {
  assert.equal(
    getLastMailMessageTimestamp(
      ctxWithBranch([
        { type: 'custom_message', customType: CLAWAS_MAIL_MESSAGE_TYPE, timestamp: 10 },
        {
          type: 'custom',
          customType: CLAWAS_MAIL_MESSAGE_TYPE,
          timestamp: '2026-01-01T00:00:02.000Z',
          data: { details: { workerId: 'main-claw' } },
        },
      ]),
    ),
    Date.parse('2026-01-01T00:00:02.000Z'),
  )
})

test('auto report ignores context-only mail and hydration preloads', () => {
  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: 'real worker status',
      lastMailDetails: { intent: 'for_context' },
      messageTimestamp: 10,
      lastMailTimestamp: 10,
    }),
    false,
  )
  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: 'real worker status',
      lastMailDetails: { intent: 'for_context' },
      messageTimestamp: 20,
      lastMailTimestamp: 10,
    }),
    true,
  )
  assert.equal(shouldReportClawaFinalToMain({ messageContent: '  ' }), false)
  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: '## Claw Continuity Refresh (auto-loaded)\nstate',
    }),
    false,
  )
})
