import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMessageDetails,
  buildWorkerUserMessage,
  ClawasCommsServer,
  shouldDeliverClawasMailAsUserMessage,
} from './server.ts'

const DISCORD_ROOM_UPDATE_REGEX = /^\[Discord room update\]/
const RECENT_CONTEXT_REGEX = /Recent channel context:\nmember-a: hey/
const CURRENT_TRIGGER_REGEX = /\n\nmember-b: ping$/

test('only discord-gateway mail uses the worker-facing Discord user-message envelope', () => {
  const details = buildMessageDetails(
    { workerId: 'discord-gateway', workerTitle: 'Discord gateway' },
    { sourceMessageId: 'dc-msg-1', queueRowId: 42 },
    'mail',
    'reply_requested',
    'worker',
  )

  assert.equal(shouldDeliverClawasMailAsUserMessage(details), true)
  assert.equal(details.queueRowId, 42)
  const message = buildWorkerUserMessage(
    'Recent channel context:\nmember-a: hey\nEnd recent channel context.\nmember-b: ping',
    details,
  )

  assert.match(message, DISCORD_ROOM_UPDATE_REGEX)
  assert.match(message, RECENT_CONTEXT_REGEX)
  assert.match(message, CURRENT_TRIGGER_REGEX)
})

function makeServerHarness() {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const pi = {
    appendEntry: (...args: unknown[]) => calls.push({ name: 'appendEntry', args }),
    sendUserMessage: (...args: unknown[]) => calls.push({ name: 'sendUserMessage', args }),
    sendMessage: (...args: unknown[]) => calls.push({ name: 'sendMessage', args }),
  }
  const server = new ClawasCommsServer(pi as never, () => 'worker')
  const ctx = { isIdle: () => true }
  return { server, ctx, calls }
}

test('for_context startup mail is stored as custom context without triggering a worker turn', () => {
  const { server, ctx, calls } = makeServerHarness()

  ;(
    server as never as {
      handleSendCommand: (ctx: unknown, command: unknown) => void
    }
  ).handleSendCommand(ctx, {
    type: 'send',
    message: 'startup preload',
    messageType: 'session',
    mode: 'steer',
    sender: { workerId: 'main-claw', workerTitle: 'Clawa' },
    kind: 'instruction',
    intent: 'for_context',
    visibility: 'worker',
  })

  assert.deepEqual(
    calls.map((entry) => entry.name),
    ['sendMessage'],
  )
  const firstCall = calls[0]
  assert.ok(firstCall)
  assert.equal((firstCall.args[1] as { triggerTurn?: boolean }).triggerTurn, false)
  assert.equal((firstCall.args[0] as { customType?: string }).customType, 'clawas-session')
})

test('discord gateway mail still wakes the worker through the Discord user-message path', () => {
  const { server, ctx, calls } = makeServerHarness()

  ;(
    server as never as {
      handleSendCommand: (ctx: unknown, command: unknown) => void
    }
  ).handleSendCommand(ctx, {
    type: 'send',
    message: 'member-b: ping',
    messageType: 'session',
    sender: { workerId: 'discord-gateway', workerTitle: 'Discord gateway' },
    kind: 'mail',
    intent: 'reply_requested',
    visibility: 'worker',
  })

  assert.deepEqual(
    calls.map((call) => call.name),
    ['appendEntry', 'sendUserMessage'],
  )
  const wakeCall = calls[1]
  assert.ok(wakeCall)
  assert.match(wakeCall.args[0] as string, DISCORD_ROOM_UPDATE_REGEX)
})
