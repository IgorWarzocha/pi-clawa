import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { ClawasMailDelivery } from './mail-delivery.js'

test('idle mail coalesces into one prepared kickoff; arrivals during prep wait for agent start', async () => {
  const sent: string[] = []
  const metadata: unknown[] = []
  let firstSend: () => void = () => assert.fail('missing kickoff')
  const first = new Promise<void>((resolve) => {
    firstSend = resolve
  })
  const pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage' | 'sendUserMessage'> = {
    appendEntry(_type, entry) {
      metadata.push(entry)
    },
    sendMessage() {
      assert.fail('actionable mail must not take custom message path')
    },
    sendUserMessage(content, options) {
      sent.push(`${String(content)}:${options?.deliverAs ?? 'idle'}`)
      firstSend()
    },
  }
  const mail = new ClawasMailDelivery(pi, (error) => assert.fail(error.message))
  const ctx = { isIdle: () => true }
  mail.send(ctx, { type: 'send', message: 'first' }, () => true)
  mail.send(ctx, { type: 'send', message: 'second' }, () => true)
  assert.equal(mail.hasPendingKickoff, true)
  await first
  assert.equal(sent.length, 1)
  assert.ok((sent[0] ?? '').includes('first'))
  assert.ok((sent[0] ?? '').indexOf('first') < (sent[0] ?? '').indexOf('second'))
  mail.send(ctx, { type: 'send', message: 'third' }, () => true)
  assert.equal(sent.length, 1)
  mail.agentStart()
  assert.equal(sent.length, 2)
  assert.ok((sent[1] ?? '').includes('third:steer'))
  assert.equal(metadata.length, 3)
  assert.equal(mail.hasPendingKickoff, false)
})

test('failed idle kickoff clears pending state and reports failure after mail metadata persists', async () => {
  const metadata: unknown[] = []
  let failure: (error: Error) => void = () => assert.fail('missing failure')
  const failed = new Promise<Error>((resolve) => {
    failure = resolve
  })
  const pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage' | 'sendUserMessage'> = {
    appendEntry(_type, entry) {
      metadata.push(entry)
    },
    sendMessage() {
      assert.fail('wrong delivery path')
    },
    sendUserMessage() {
      throw new Error('preparation rejected')
    },
  }
  const mail = new ClawasMailDelivery(pi, failure)
  mail.send({ isIdle: () => true }, { type: 'send', message: 'important' }, () => true)
  assert.ok((await failed).message.includes('preparation rejected'))
  assert.equal(metadata.length, 1)
  assert.equal(mail.hasPendingKickoff, false)
})
