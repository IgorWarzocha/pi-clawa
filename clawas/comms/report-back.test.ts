import assert from 'node:assert/strict'
import test from 'node:test'
import { getLastDiscordSourceMessageId, getLastMailMessageTimestamp } from './message-extract.ts'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.ts'
import {
  extractClawaReportText,
  normalizeDiscordReplyText,
  shouldAutoRelayFinalAssistantToDiscord,
  shouldReportClawaFinalToMain,
  shouldSkipAutoDiscordRelay,
  shouldSkipAutoMainClawStatusRelay,
} from './report-back-helpers.ts'

function ctxWithBranch(branch: unknown[]) {
  return {
    sessionManager: {
      getBranch: () => branch,
    },
  } as never
}

test('extractClawaReportText keeps explicit clawas content only', () => {
  assert.equal(extractClawaReportText('[CLAWAS]\nhello from worker'), 'hello from worker')
  assert.equal(extractClawaReportText('[CLAWAS] hello from worker'), 'hello from worker')
  assert.equal(extractClawaReportText('plain assistant text'), null)
})

test('shouldAutoRelayFinalAssistantToDiscord is disabled for gateway-delivered final text', () => {
  assert.equal(
    shouldAutoRelayFinalAssistantToDiscord({
      workerId: 'discord-clawa',
      discordEnabled: '1',
    }),
    false,
  )
  assert.equal(
    shouldAutoRelayFinalAssistantToDiscord({
      workerId: 'job-a-clawa',
      discordEnabled: '1',
    }),
    false,
  )
  assert.equal(
    shouldAutoRelayFinalAssistantToDiscord({
      workerId: 'discord-clawa',
      discordEnabled: '0',
    }),
    false,
  )
})

test('normalizeDiscordReplyText drops any output containing the sentinel and blank output', () => {
  assert.equal(normalizeDiscordReplyText('hello'), 'hello')
  assert.equal(normalizeDiscordReplyText('  [nothing_for_discord]  '), null)
  assert.equal(normalizeDiscordReplyText('prefix [nothing_for_discord] suffix'), null)
  assert.equal(
    normalizeDiscordReplyText('I finish with [nothing_for_discord] so the gateway does not echo.'),
    null,
  )
  assert.equal(normalizeDiscordReplyText('   \n  '), null)
})

test('shouldSkipAutoDiscordRelay suppresses stale discord replays after an explicit discord delivery', () => {
  assert.equal(
    shouldSkipAutoDiscordRelay({
      message: { content: 'old final', timestamp: 10 },
      lastDelivery: { route: 'discord', content: 'extra beat', timestamp: 20 },
    }),
    true,
  )

  assert.equal(
    shouldSkipAutoDiscordRelay({
      message: { content: 'new final', timestamp: 30 },
      lastDelivery: { route: 'discord', content: 'extra beat', timestamp: 20 },
    }),
    false,
  )

  assert.equal(
    shouldSkipAutoDiscordRelay({
      message: { content: 'private handoff', timestamp: 10 },
      lastDelivery: { route: 'main-claw', content: 'note', timestamp: 20 },
    }),
    false,
  )
})

test('getLastDiscordSourceMessageId only uses the current gateway mail turn', () => {
  const oldGatewayMail = {
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: {
      workerId: 'discord-gateway',
      sourceMessageId: 'old-discord-message',
    },
  }
  const mainClawHandoff = {
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: {
      workerId: 'main-claw',
    },
  }
  const ambientGatewayMail = {
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: {
      workerId: 'discord-gateway',
    },
  }

  assert.equal(
    getLastDiscordSourceMessageId(ctxWithBranch([oldGatewayMail])),
    'old-discord-message',
  )
  assert.equal(
    getLastDiscordSourceMessageId(
      ctxWithBranch([
        {
          type: 'custom',
          customType: CLAWAS_MAIL_MESSAGE_TYPE,
          data: {
            details: {
              workerId: 'discord-gateway',
              sourceMessageId: 'durable-discord-message',
            },
          },
        },
      ]),
    ),
    'durable-discord-message',
  )
  assert.equal(
    getLastDiscordSourceMessageId(ctxWithBranch([oldGatewayMail, mainClawHandoff])),
    undefined,
  )
  assert.equal(
    getLastDiscordSourceMessageId(ctxWithBranch([oldGatewayMail, ambientGatewayMail])),
    undefined,
  )
})

test('shouldSkipAutoMainClawStatusRelay suppresses auto status after same-turn handoff', () => {
  assert.equal(
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery: { route: 'main-claw', content: 'handoff', timestamp: 20 },
      lastMailTimestamp: 10,
    }),
    true,
  )

  assert.equal(
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery: {
        route: 'main-claw',
        content: 'old handoff',
        timestamp: 5,
      },
      lastMailTimestamp: 10,
    }),
    false,
  )

  assert.equal(
    shouldSkipAutoMainClawStatusRelay({
      lastDelivery: { route: 'discord', content: 'public', timestamp: 20 },
      lastMailTimestamp: 10,
    }),
    false,
  )
})

test('getLastMailMessageTimestamp returns nearest CLAWAS mail timestamp', () => {
  assert.equal(
    getLastMailMessageTimestamp(
      ctxWithBranch([
        {
          type: 'custom_message',
          customType: CLAWAS_MAIL_MESSAGE_TYPE,
          timestamp: 10,
        },
        { type: 'message', message: { role: 'assistant', content: 'hi' } },
        {
          type: 'custom_message',
          customType: CLAWAS_MAIL_MESSAGE_TYPE,
          timestamp: '2026-01-01T00:00:01.000Z',
        },
      ]),
    ),
    Date.parse('2026-01-01T00:00:01.000Z'),
  )

  assert.equal(
    getLastMailMessageTimestamp(
      ctxWithBranch([
        {
          type: 'custom',
          customType: CLAWAS_MAIL_MESSAGE_TYPE,
          timestamp: '2026-01-01T00:00:02.000Z',
          data: { details: { workerId: 'discord-gateway' } },
        },
      ]),
    ),
    Date.parse('2026-01-01T00:00:02.000Z'),
  )
})

test('main-claw auto report ignores startup context and hydration preload text', () => {
  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: 'real worker status',
      lastMailDetails: { intent: 'reply_requested' },
    }),
    true,
  )

  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: 'real worker status',
      lastMailDetails: { intent: 'for_context' },
    }),
    false,
  )

  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: '## Claw Continuity Refresh (auto-loaded)\n\nThis is for you, the claw.',
      lastMailDetails: { intent: 'reply_requested' },
    }),
    false,
  )
})

test('getLastMailMessageTimestamp includes legacy session/report messages', () => {
  assert.equal(
    getLastMailMessageTimestamp(
      ctxWithBranch([
        {
          type: 'custom_message',
          customType: 'clawas-session',
          timestamp: '2026-01-01T00:00:03.000Z',
          details: { intent: 'for_context' },
        },
      ]),
    ),
    Date.parse('2026-01-01T00:00:03.000Z'),
  )
})
