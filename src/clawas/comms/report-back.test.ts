import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAssistantTurns,
  getLastAssistantTurn,
  getLastDiscordChannelJid,
  getLastDiscordSourceMessageId,
  getLastMailMessageTimestamp,
} from './message-extract.ts'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.ts'
import {
  extractClawaReportText,
  normalizeDiscordReplyText,
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

test('normalizeDiscordReplyText drops standalone quiet sentinel and blank output', () => {
  assert.equal(normalizeDiscordReplyText('hello'), 'hello')
  assert.equal(normalizeDiscordReplyText('  [quiet]  '), null)
  assert.equal(normalizeDiscordReplyText('  [quiet]:  '), null)
  assert.equal(normalizeDiscordReplyText('[react m1: 😄]\n[quiet]'), null)
  assert.equal(normalizeDiscordReplyText('Room chatter, nothing directed at me.\n\n[quiet]'), null)
  assert.equal(
    normalizeDiscordReplyText('Room chatter, nothing directed at me.\n\n[quiet]\n\n[quiet]'),
    null,
  )
  assert.equal(normalizeDiscordReplyText('prefix [quiet] suffix'), 'prefix [quiet] suffix')
  assert.equal(
    normalizeDiscordReplyText('I finish with [quiet] so the gateway does not echo.'),
    'I finish with [quiet] so the gateway does not echo.',
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

test('getLastDiscordSourceMessageId uses nearest carried Discord context only', () => {
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

  assert.equal(
    getLastDiscordSourceMessageId(
      ctxWithBranch([
        oldGatewayMail,
        {
          ...mainClawHandoff,
          details: {
            workerId: 'main-claw',
            sourceMessageId: 'carried-discord-message',
          },
        },
      ]),
    ),
    'carried-discord-message',
  )
})

test('assistant output stays paired with the Discord mail that preceded its turn', () => {
  const mail = (channelJid: string) => ({
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: { workerId: 'discord-gateway', channelJid },
  })
  const user = (content: string) => ({
    type: 'message',
    message: { role: 'user', content, timestamp: 1 },
  })
  const assistant = (content: string) => ({
    type: 'message',
    message: { role: 'assistant', content, timestamp: 2, stopReason: 'stop' },
  })
  const turn = getLastAssistantTurn(
    ctxWithBranch([
      mail('dc:dm-a'),
      user('message from A'),
      mail('dc:dm-b'),
      assistant('[dm] reply to A while B is queued'),
    ]),
  )

  assert.equal(turn?.message.content, '[dm] reply to A while B is queued')
  assert.equal(turn?.mailDetails?.['channelJid'], 'dc:dm-a')
})

test('assistant turn history preserves every queued Discord output in order', () => {
  const mail = (queueRowId: number) => ({
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: { workerId: 'discord-gateway', queueRowId },
  })
  const user = (content: string, timestamp: number) => ({
    type: 'message',
    message: { role: 'user', content, timestamp },
  })
  const assistant = (content: string, timestamp: number) => ({
    type: 'message',
    message: { role: 'assistant', content, timestamp, stopReason: 'stop' },
  })

  const turns = getAssistantTurns(
    ctxWithBranch([
      mail(41),
      user('first', 1),
      assistant('[dm] first reply', 2),
      mail(42),
      user('second', 3),
      assistant('[dm] second reply', 4),
    ]),
  )

  assert.deepEqual(
    turns.map((turn) => ({
      content: turn.message.content,
      queueRowId: turn.mailDetails?.['queueRowId'],
    })),
    [
      { content: '[dm] first reply', queueRowId: 41 },
      { content: '[dm] second reply', queueRowId: 42 },
    ],
  )
})

test('getLastDiscordChannelJid uses nearest carried Discord context only', () => {
  const gatewayMail = {
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: {
      workerId: 'discord-gateway',
      channelJid: 'dc:channel-1',
    },
  }
  const mainClawHandoff = {
    type: 'custom_message',
    customType: CLAWAS_MAIL_MESSAGE_TYPE,
    details: {
      workerId: 'main-claw',
    },
  }

  assert.equal(getLastDiscordChannelJid(ctxWithBranch([gatewayMail])), 'dc:channel-1')
  assert.equal(getLastDiscordChannelJid(ctxWithBranch([gatewayMail, mainClawHandoff])), undefined)
  assert.equal(
    getLastDiscordChannelJid(
      ctxWithBranch([
        gatewayMail,
        {
          ...mainClawHandoff,
          details: {
            workerId: 'main-claw',
            channelJid: 'dc:carried-channel',
          },
        },
      ]),
    ),
    'dc:carried-channel',
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

  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: '## Claw Continuity Refresh (auto-loaded)\n\nThis is for you, the claw.',
      lastMailDetails: { intent: 'reply_requested' },
    }),
    false,
  )

  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: '[quiet]',
      lastMailDetails: { intent: 'reply_requested' },
    }),
    false,
  )

  assert.equal(
    shouldReportClawaFinalToMain({
      messageContent: '[react m1: 😄]\n[quiet]',
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
