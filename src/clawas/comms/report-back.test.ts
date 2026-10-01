import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssistantTurns, getLastAssistantTurn } from './message-extract.ts'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.ts'

function ctxWithBranch(branch: unknown[]) {
  return {
    sessionManager: {
      getBranch: () => branch,
    },
  } as never
}

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

test('assistant output keeps Discord context across tool calls in the same turn', () => {
  const details = {
    workerId: 'discord-gateway',
    sourceMessageId: 'current-trigger',
    channelJid: 'dc:channel-a',
    queueRowId: 540,
    messageHandles: {
      m7: { channelJid: 'dc:channel-a', messageId: 'issue-message' },
      m8: { channelJid: 'dc:channel-a', messageId: 'current-trigger' },
    },
  }
  const turn = getLastAssistantTurn(
    ctxWithBranch([
      {
        type: 'custom_message',
        customType: CLAWAS_MAIL_MESSAGE_TYPE,
        details,
      },
      {
        type: 'message',
        message: { role: 'user', content: 'wut?', timestamp: 1 },
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'inspect', arguments: {} }],
          timestamp: 2,
          stopReason: 'toolUse',
        },
      },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'inspect',
          content: [{ type: 'text', text: 'evidence' }],
          timestamp: 3,
        },
      },
      {
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '[#channel-a]: final reply' }],
          timestamp: 4,
          stopReason: 'stop',
        },
      },
    ]),
  )

  assert.equal(turn?.message.content, '[#channel-a]: final reply')
  assert.deepEqual(turn?.mailDetails, details)
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
