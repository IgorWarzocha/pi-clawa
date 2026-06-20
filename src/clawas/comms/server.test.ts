import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMessageDetails,
  buildWorkerUserMessage,
  ClawasCommsServer,
  shouldDeliverClawasMailAsUserMessage,
} from './server.ts'

const DISCORD_ROOM_UPDATE_REGEX = /^\[Discord room update\]/
const RECENT_CONTEXT_REGEX = /Recent channel context:\nIgor: hey/
const CURRENT_TRIGGER_REGEX = /Current trigger:\nJosXa: ping/
const CLAWAS_WORKER_UPDATE_REGEX = /^\[Clawas worker update\]/
const DISCORD_ROOM_UPDATE_OPEN_REGEX = /^\[Discord room update/

test('only discord-gateway mail uses the worker-facing Discord user-message envelope', () => {
  const details = buildMessageDetails(
    { workerId: 'discord-gateway', workerTitle: 'Discord gateway' },
    { sourceMessageId: 'dc-msg-1' },
    'mail',
    'reply_requested',
    'worker',
  )

  assert.equal(shouldDeliverClawasMailAsUserMessage(details), true)
  const message = buildWorkerUserMessage(
    'Recent channel context:\nIgor: hey\nEnd recent channel context.\nJosXa: ping',
    details,
  )

  assert.match(message, DISCORD_ROOM_UPDATE_REGEX)
  assert.match(message, RECENT_CONTEXT_REGEX)
  assert.match(message, CURRENT_TRIGGER_REGEX)
})

test('worker reports are not routed through the chunky user-message envelope', () => {
  const details = buildMessageDetails(
    { workerId: 'discord-clawa', workerTitle: 'discord-clawa' },
    undefined,
    'report',
    'handoff',
    'private',
  )

  assert.equal(shouldDeliverClawasMailAsUserMessage(details), false)
  const message = buildWorkerUserMessage('Got the update.', details)

  assert.match(message, CLAWAS_WORKER_UPDATE_REGEX)
  assert.doesNotMatch(message, DISCORD_ROOM_UPDATE_OPEN_REGEX)
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
    message: 'JosXa: ping',
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
