import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMessageDetails,
  buildWorkerUserMessage,
  ClawasCommsServer,
  shouldDeliverClawasMailAsUserMessage,
} from './server.ts'

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

  assert.match(message, /^\[Discord room update\]/)
  assert.match(message, /Recent channel context:\nIgor: hey/)
  assert.match(message, /Current trigger:\nJosXa: ping/)
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

  assert.match(message, /^\[Clawas worker update\]/)
  assert.doesNotMatch(message, /^\[Discord room update/)
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
    calls.map((call) => call.name),
    ['sendMessage'],
  )
  assert.equal((calls[0].args[1] as { triggerTurn?: boolean }).triggerTurn, false)
  assert.equal((calls[0].args[0] as { customType?: string }).customType, 'clawas-session')
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
  assert.match(calls[1].args[0] as string, /^\[Discord room update\]/)
})
