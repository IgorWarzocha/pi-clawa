import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { ClawasMailDelivery } from './mail-delivery.js'

const UNCONFIRMED_ERROR = /not acknowledged/u
const CHANGED_ERROR = /session changed/u
const ctx = {
  isIdle: () => true,
  model: { provider: 'offline' },
  modelRegistry: { hasConfiguredAuth: () => true },
} as unknown as ExtensionContext

test('idle mail coalesces into one prepared kickoff; arrivals during prep wait for agent start', async () => {
  const sent: string[] = []
  const metadata: unknown[] = []
  const pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage' | 'sendUserMessage'> = {
    appendEntry(_type, entry) {
      metadata.push(entry)
    },
    sendMessage() {
      assert.fail('actionable mail must not take custom message path')
    },
    sendUserMessage(content, options) {
      sent.push(`${String(content)}:${options?.deliverAs ?? 'idle'}`)
    },
  }
  const mail = new ClawasMailDelivery(pi, (error) => assert.fail(error.message))
  const first = mail.send(ctx, { type: 'send', message: 'first' }, () => true)
  const second = mail.send(ctx, { type: 'send', message: 'second' }, () => true)
  assert.equal(mail.hasPendingKickoff, true)
  await Promise.all([first, second])
  assert.equal(sent.length, 1)
  assert.ok((sent[0] ?? '').includes('first'))
  assert.ok((sent[0] ?? '').indexOf('first') < (sent[0] ?? '').indexOf('second'))
  await mail.send(ctx, { type: 'send', message: 'third' }, () => true)
  assert.equal(sent.length, 1)
  mail.agentStart()
  assert.equal(sent.length, 2)
  assert.ok((sent[1] ?? '').includes('third:steer'))
  assert.equal(metadata.length, 3)
  assert.equal(mail.hasPendingKickoff, false)
})

test('unacknowledged fire-and-forget starts surface uncertainty without retrying a possibly live turn', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let sends = 0
  const failures: Error[] = []
  const mail = new ClawasMailDelivery(
    {
      appendEntry() {},
      sendMessage() {},
      sendUserMessage() {
        sends += 1
      },
    },
    (error) => failures.push(error),
  )
  await mail.send(ctx, { type: 'send', message: 'first' }, () => true)
  await mail.send(ctx, { type: 'send', message: 'waiting' }, () => true)
  t.mock.timers.tick(15_000)
  assert.equal(failures.length, 1)
  assert.match(failures[0]!.message, UNCONFIRMED_ERROR)
  assert.equal(sends, 1)
  assert.equal(mail.hasPendingKickoff, false)
  await assert.rejects(
    mail.send(ctx, { type: 'send', message: 'later' }, () => true),
    UNCONFIRMED_ERROR,
  )
  // Slow preparation can still succeed. Only the not-yet-submitted mail is then steered.
  mail.agentStart()
  assert.equal(sends, 2)
  t.mock.timers.tick(15_000)
  assert.equal(failures.length, 1)
  mail.reset()
})

test('reset fences a scheduled kickoff without consuming the replacement session queue', async () => {
  const sent: string[] = []
  const mail = new ClawasMailDelivery(
    {
      appendEntry() {},
      sendMessage() {},
      sendUserMessage(content) {
        sent.push(String(content))
      },
    },
    (error) => assert.fail(error.message),
  )
  const stale = assert.rejects(
    mail.send(ctx, { type: 'send', message: 'stale' }, () => true),
    CHANGED_ERROR,
  )
  mail.reset()
  await mail.send(ctx, { type: 'send', message: 'current' }, () => true)
  await stale
  assert.equal(sent.length, 1)
  assert.ok(sent[0]!.includes('current'))
  assert.equal(sent[0]!.includes('stale'), false)
  mail.agentStart()
})
