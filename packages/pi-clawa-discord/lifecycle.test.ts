import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { readSessionTokensFromJsonl } from './src/gateway/agent/session-status.js'
import {
  claimNextDiscordDeliveryInDb,
  deliveryNonceForKey,
  enqueueDiscordDeliveryInDb,
  getDiscordDeliveryStateInDb,
  markDiscordDeliveryAttemptFailedInDb,
  recoverStuckDiscordDeliveriesInDb,
} from './src/gateway/db/delivery-queue.js'
import { enqueueDiscordInteractionTurnInDb } from './src/gateway/db/interactions.js'
import {
  markMessageAwaitingInDb,
  markMessageDoneInDb,
  markMessageFailedInDb,
  recoverStuckMessagesInDb,
} from './src/gateway/db/queue.js'
import { runSchemaMigrations } from './src/gateway/db/schema.js'
import { sendDiscordDeliveryWithClient } from './src/gateway/discord/delivery-renderer.js'
import { splitDiscordMessage } from './src/gateway/discord/text.js'
import { parseBooleanSetting, parseEnumSetting, parseIntegerSetting } from './src/shared/env.js'
import { acquireGatewayLock, readGatewayLock } from './src/shared/gateway-lock.js'

const DELIVERY_KEY_COLLISION_PATTERN = /delivery key collision/u
const QUEUE_UNAVAILABLE_PATTERN = /queue unavailable/u
const INVALID_LIMIT_PATTERN = /Invalid LIMIT/u
const INVALID_ENABLED_PATTERN = /Invalid ENABLED/u
const INVALID_POLICY_PATTERN = /Invalid POLICY/u
const ALREADY_RUNNING_PATTERN = /already running/u

test('Discord inbox settles only after the worker turn and preserves awaiting work on restart', () => {
  const db = new Database(':memory:')
  try {
    runSchemaMigrations(db)
    db.prepare(`
      insert into message_queue
        (channel_jid, sender, sender_name, content, timestamp, status)
      values
        ('dc:one', 'human', 'Human', 'first', datetime('now'), 'processing'),
        ('dc:one', 'human', 'Human', 'second', datetime('now'), 'processing')
    `).run()

    assert.equal(markMessageAwaitingInDb(db, 1), true)
    assert.equal(recoverStuckMessagesInDb(db), 1)
    assert.deepEqual(db.prepare('select rowid, status from message_queue order by rowid').all(), [
      { rowid: 1, status: 'awaiting' },
      { rowid: 2, status: 'pending' },
    ])

    markMessageDoneInDb(db, 1)
    assert.equal(markMessageAwaitingInDb(db, 1), false)
    markMessageFailedInDb(db, 2)
    assert.equal(
      (db.prepare('select status from message_queue where rowid = 2').get() as { status: string })
        .status,
      'failed',
    )
  } finally {
    db.close()
  }
})

test('Discord outbox keys, nonces, retry states, and recovery are durable', () => {
  const db = new Database(':memory:')
  try {
    runSchemaMigrations(db)
    const request = { channelJid: 'dc:one', text: 'hello', files: [] }
    const rowid = enqueueDiscordDeliveryInDb(db, request, {
      deliveryKey: 'worker:one:reply:0',
      maxAttempts: 2,
    })
    assert.equal(
      enqueueDiscordDeliveryInDb(db, request, { deliveryKey: 'worker:one:reply:0' }),
      rowid,
    )
    assert.throws(
      () =>
        enqueueDiscordDeliveryInDb(
          db,
          { ...request, text: 'different' },
          { deliveryKey: 'worker:one:reply:0' },
        ),
      DELIVERY_KEY_COLLISION_PATTERN,
    )

    const first = claimNextDiscordDeliveryInDb(db, 1_000)
    assert.equal(first?.nonce, deliveryNonceForKey('worker:one:reply:0'))
    assert.equal(first?.attempt_count, 1)
    assert.equal(markDiscordDeliveryAttemptFailedInDb(db, rowid, 'network', 1_000), 'pending')
    assert.equal(claimNextDiscordDeliveryInDb(db, 1_999), undefined)

    const second = claimNextDiscordDeliveryInDb(db, 2_000)
    assert.equal(second?.attempt_count, 2)
    assert.equal(markDiscordDeliveryAttemptFailedInDb(db, rowid, 'still down', 2_000), 'dead')
    assert.deepEqual(getDiscordDeliveryStateInDb(db, rowid), {
      status: 'dead',
      attempts: 2,
      result: undefined,
      error: 'still down',
    })

    const recoverable = enqueueDiscordDeliveryInDb(db, request, {
      deliveryKey: 'worker:one:reply:1',
    })
    assert.equal(claimNextDiscordDeliveryInDb(db, 3_000)?.rowid, recoverable)
    assert.deepEqual(recoverStuckDiscordDeliveriesInDb(db), { retried: 1, dead: 0 })
    assert.equal(claimNextDiscordDeliveryInDb(db, 3_000)?.rowid, recoverable)
    db.prepare("update discord_delivery_queue set status = 'done' where rowid = ?").run(recoverable)

    const uncertain = enqueueDiscordDeliveryInDb(db, request, {
      deliveryKey: 'worker:one:reply:2',
    })
    db.prepare(`
      update discord_delivery_queue
      set status = 'processing', started_at = '2000-01-01 00:00:00'
      where rowid = ?
    `).run(uncertain)
    assert.deepEqual(recoverStuckDiscordDeliveriesInDb(db), { retried: 0, dead: 1 })
    assert.equal(getDiscordDeliveryStateInDb(db, uncertain)?.status, 'dead')
  } finally {
    db.close()
  }
})

test('Discord multipart text becomes independently deliverable chunks', () => {
  const chunks = splitDiscordMessage('x'.repeat(4_501))
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [2_000, 2_000, 501],
  )
  assert.equal(chunks.join(''), 'x'.repeat(4_501))
})

test('Discord sends carry enforced stable nonces', async () => {
  let sentPayload: Record<string, unknown> | undefined
  const client = {
    channels: {
      fetch: async () => ({
        send: async (payload: Record<string, unknown>) => {
          sentPayload = payload
          return { id: 'message-one' }
        },
      }),
    },
  }

  const result = await sendDiscordDeliveryWithClient(
    client as never,
    { channelJid: 'dc:one', text: 'hello', replyToMessageId: 'current-trigger', files: [] },
    'stable-nonce',
  )
  assert.equal(result.messageId, 'message-one')
  assert.equal(sentPayload?.['nonce'], 'stable-nonce')
  assert.equal(sentPayload?.['enforceNonce'], true)
  assert.deepEqual(sentPayload?.['reply'], {
    messageReference: 'current-trigger',
    failIfNotExists: false,
  })
})

test('Discord long text retries each rendered chunk idempotently', async () => {
  const sentPayloads: Record<string, unknown>[] = []
  const client = {
    channels: {
      fetch: async () => ({
        send: async (payload: Record<string, unknown>) => {
          sentPayloads.push(payload)
          return { id: `message-${sentPayloads.length}` }
        },
      }),
    },
  }

  const result = await sendDiscordDeliveryWithClient(
    client as never,
    { channelJid: 'dc:one', text: 'x'.repeat(4_501), files: [] },
    'stable-parent-nonce',
  )
  assert.equal(result.messageId, 'message-3')
  assert.deepEqual(
    sentPayloads.map((payload) => String(payload['content']).length),
    [2_000, 2_000, 501],
  )
  const nonces = sentPayloads.map((payload) => String(payload['nonce']))
  assert.equal(new Set(nonces).size, 3)
  assert.ok(nonces.every((nonce) => nonce.length <= 24))
  assert.ok(sentPayloads.every((payload) => payload['enforceNonce'] === true))
})

test('Discord interaction consumption rolls back when enqueue fails', () => {
  const db = new Database(':memory:')
  try {
    runSchemaMigrations(db)
    db.prepare(`
      insert into discord_interactions
        (token, channel_jid, kind, payload_json, expires_at)
      values ('token', 'dc:one', 'button', '{}', 10000)
    `).run()
    db.exec(`
      create trigger reject_interaction_queue
      before insert on message_queue
      begin
        select raise(abort, 'queue unavailable');
      end;
    `)

    assert.throws(
      () =>
        enqueueDiscordInteractionTurnInDb(db, {
          token: 'token',
          channelJid: 'dc:one',
          senderId: 'human',
          senderName: 'Human',
          sourceMessageId: 'interaction-one',
          content: 'Do the thing',
          timestamp: new Date().toISOString(),
          now: 1,
        }),
      QUEUE_UNAVAILABLE_PATTERN,
    )
    assert.equal(
      (
        db.prepare("select consumed_at from discord_interactions where token = 'token'").get() as {
          consumed_at: number | null
        }
      ).consumed_at,
      null,
    )
    assert.equal(
      (db.prepare('select count(*) as count from message_log').get() as { count: number }).count,
      0,
    )
  } finally {
    db.close()
  }
})

test('Discord interaction consumption and enqueue commit together', () => {
  const db = new Database(':memory:')
  try {
    runSchemaMigrations(db)
    db.prepare(`
      insert into discord_interactions
        (token, channel_jid, kind, payload_json, expires_at)
      values ('token', 'dc:one', 'button', '{}', 10000)
    `).run()
    const options = {
      token: 'token',
      channelJid: 'dc:one',
      senderId: 'human',
      senderName: 'Human',
      sourceMessageId: 'interaction-one',
      content: 'Do the thing',
      timestamp: new Date().toISOString(),
      now: 1,
    }
    assert.equal(enqueueDiscordInteractionTurnInDb(db, options), true)
    assert.equal(enqueueDiscordInteractionTurnInDb(db, options), false)
    assert.equal(
      (db.prepare('select count(*) as count from message_queue').get() as { count: number }).count,
      1,
    )
  } finally {
    db.close()
  }
})

test('Discord settings reject malformed values instead of changing behavior', () => {
  assert.equal(parseIntegerSetting({ LIMIT: '4' }, 'LIMIT', 1, { min: 1 }), 4)
  assert.throws(() => parseIntegerSetting({ LIMIT: '4oops' }, 'LIMIT', 1), INVALID_LIMIT_PATTERN)
  assert.equal(parseBooleanSetting({ ENABLED: 'off' }, 'ENABLED', true), false)
  assert.throws(
    () => parseBooleanSetting({ ENABLED: 'perhaps' }, 'ENABLED', true),
    INVALID_ENABLED_PATTERN,
  )
  assert.throws(
    () => parseEnumSetting({ POLICY: 'public' }, 'POLICY', 'open', ['open', 'allowlist']),
    INVALID_POLICY_PATTERN,
  )
})

test('Discord session status reads JSONL without launching Pi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-session-status-'))
  try {
    const session = join(root, 'session.jsonl')
    await writeFile(
      session,
      `${JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17 },
        },
      })}\n{unfinished`,
    )
    assert.deepEqual(readSessionTokensFromJsonl(session), {
      input: 10,
      output: 4,
      cacheRead: 2,
      cacheWrite: 1,
      total: 17,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Discord gateway lock acquisition is atomic and identity-bearing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-gateway-lock-'))
  const lockPath = join(root, 'gateway.pid')
  const record = {
    pid: process.pid,
    projectRoot: root,
    entryPath: process.argv[1] ?? '',
    startedAt: new Date().toISOString(),
  }
  try {
    const release = await acquireGatewayLock(lockPath, record)
    assert.deepEqual(await readGatewayLock(lockPath), record)
    await assert.rejects(() => acquireGatewayLock(lockPath, record), ALREADY_RUNNING_PATTERN)
    await release()
    assert.equal(await readGatewayLock(lockPath), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
