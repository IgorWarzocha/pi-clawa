import assert from 'node:assert/strict'
import test from 'node:test'
import type { DiscordInboundTurn } from './src/bridge/contracts.js'
import { parseDiscordOutput, processDiscordOutput } from './src/bridge/output.js'
import { buildDiscordRoutes, DiscordRouteRegistry } from './src/bridge/routes.js'
import { DiscordTurnCoordinator } from './src/bridge/turn-coordinator.js'
import { DiscordInteractionStore } from './src/discord/interaction-store.js'
import {
  buildAliasPattern,
  canUseDiscordChannel,
  shouldAcceptDiscordMessage,
} from './src/discord/policy.js'

const INVALID_ID = /Invalid/u
const MIXED_CHANNELS = /mix channels/u

function turn(id: string, channelId = '900'): DiscordInboundTurn {
  return {
    id,
    channelId,
    cause: 'directed',
    channelLabel: '#room',
    senderName: 'Human',
    sourceMessageId: id,
    replyToMessageId: id,
    body: 'hello',
    receivedAt: '2026-09-24T00:00:00Z',
    context: [],
    attachments: [],
    handles: { [id]: { channelId, messageId: id } },
  }
}

test('queued turns stay channel-local, directed work passes ambience, and overflow is atomic', async () => {
  let idle = false
  const shown: string[][] = []
  const delivered: string[] = []
  let typing = 0
  const queue = new DiscordTurnCoordinator(
    {
      isIdle: () => idle,
      showTurns: (turns) => shown.push(turns.map((item) => item.id)),
      deliverOutput: async (_turns, text) => {
        delivered.push(text)
      },
      startTyping: () => {
        typing += 1
        return () => {
          typing -= 1
        }
      },
      report: (message) => assert.fail(message),
      stateChanged: () => {},
    },
    4,
  )
  const ambient = { ...turn('1'), cause: 'ambient' as const, batchId: 'batch' }
  assert.equal(queue.enqueueBatch([ambient, { ...ambient, id: '2', sourceMessageId: '2' }]), true)
  queue.enqueue(turn('3', '901'))
  queue.enqueue(turn('4'))
  assert.equal(queue.enqueue(turn('4')), true)
  assert.equal(queue.enqueueBatch([turn('5'), turn('6')]), false)
  idle = true
  queue.wake()
  assert.deepEqual(shown, [['3']])
  assert.equal(typing, 1)
  queue.captureAssistant('[c] first')
  await queue.settle()
  assert.deepEqual(shown, [['3'], ['4']])
  queue.captureAssistant('[c] second')
  await queue.settle()
  assert.deepEqual(shown, [['3'], ['4'], ['1', '2']])
  queue.captureAssistant('')
  await queue.settle()
  assert.deepEqual(delivered, ['[c] first', '[c] second', ''])
  assert.equal(typing, 0)
  assert.equal(queue.enqueue(turn('3')), true)
  assert.equal(shown.length, 3)
  queue.stop()
  assert.equal(queue.enqueue(turn('7')), false)
})

test('settlement is single-flight and shutdown cannot revive queued work', async () => {
  const done = Promise.withResolvers<void>()
  let deliveries = 0
  let shown = 0
  const queue = new DiscordTurnCoordinator(
    {
      isIdle: () => true,
      showTurns: () => {
        shown += 1
      },
      deliverOutput: async () => {
        deliveries += 1
        await done.promise
      },
      startTyping: () => () => {},
      report: (message) => assert.fail(message),
      stateChanged: () => {},
    },
    10,
  )
  queue.enqueue(turn('1'))
  queue.enqueue(turn('2'))
  const first = queue.settle()
  const second = queue.settle()
  assert.equal(deliveries, 1)
  queue.stop()
  done.resolve()
  await Promise.all([first, second])
  assert.equal(shown, 1)
  assert.deepEqual(queue.state, { active: [], queued: 0 })
})

test('only explicit routes leave Pi, in order, with stable non-recycled session handles', async () => {
  assert.deepEqual(parseDiscordOutput('private thoughts\n[#room] old\n[123] raw id'), [])
  const output = 'private\n[m1] reply\ncontinued\n[c] unattached\n[m2] other reply'
  const delivered: string[] = []
  await processDiscordOutput(output, async (block) => {
    await Promise.resolve()
    delivered.push(`${block.target}:${block.content}`)
  })
  assert.deepEqual(delivered, ['m1:reply\ncontinued', 'c:unattached', 'm2:other reply'])
  const registry = new DiscordRouteRegistry([{ handle: 'm9', channelId: '900', messageId: '100' }])
  assert.equal(registry.getOrCreate({ channelId: '900', messageId: '100' }).handle, 'm9')
  assert.equal(registry.getOrCreate({ channelId: '900', messageId: '101' }).handle, 'm10')
  assert.throws(() => registry.getOrCreate({ channelId: 'broken', messageId: '102' }), INVALID_ID)
  assert.throws(() => buildDiscordRoutes([turn('1'), turn('2', '901')]), MIXED_CHANNELS)
})

test('channel exclusions constrain messages and interactions; aliases cannot widen selection', () => {
  const selection = {
    channelPolicy: 'mentions' as const,
    allowedChannelIds: new Set(['900']),
    excludedChannelIds: new Set(['901']),
  }
  const message = {
    ...selection,
    channelId: '900',
    isDm: false,
    mentioned: false,
    isReplyToBot: false,
    aliasPattern: buildAliasPattern(['friend']),
    content: 'hey friend',
  }
  assert.equal(shouldAcceptDiscordMessage(message), true)
  assert.equal(shouldAcceptDiscordMessage({ ...message, content: 'friendly' }), false)
  assert.equal(shouldAcceptDiscordMessage({ ...message, channelId: '901', mentioned: true }), false)
  assert.equal(canUseDiscordChannel(selection, '901', false), false)
  assert.equal(canUseDiscordChannel(selection, '902', false), false)
  assert.equal(canUseDiscordChannel(selection, '902', true), true)
  assert.equal(
    canUseDiscordChannel(
      { ...selection, channelPolicy: 'channels', allowedChannelIds: new Set() },
      '900',
      false,
    ),
    false,
  )
})

test('interaction tokens bind to their original message and consume only once', () => {
  const store = new DiscordInteractionStore()
  const token = store.create('900', { type: 'prompt', prompt: 'hello' })
  store.attach([token], '100')
  assert.equal(store.consume(token, '901', '100'), undefined)
  assert.equal(store.consume(token, '900', '101'), undefined)
  assert.deepEqual(store.consume(token, '900', '100'), { type: 'prompt', prompt: 'hello' })
  assert.equal(store.consume(token, '900', '100'), undefined)
})
