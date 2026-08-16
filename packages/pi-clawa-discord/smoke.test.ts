import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import Database from 'better-sqlite3'
import { stopGateway } from './src/extension/gateway.js'
import { getGatewayState, setGatewayState } from './src/extension/gateway-state.js'
import { parseFinalRoutes } from './src/gateway/agent/final-routes.js'
import { runSchemaMigrations } from './src/gateway/db/schema.js'
import { stripAcceptedTrigger } from './src/gateway/discord/policy.js'
import { sanitizeDiscordLabel, sanitizeDiscordText } from './src/gateway/discord/sanitize.js'

const PRIMARY_TRIGGER_PATTERN = /^@pi\b/iu
const TRIGGER_ALIAS_PATTERN = /\b(?:claw\w*|clawa\w*)\b/iu

test('final routing blocks parse explicit destinations', () => {
  const routed = parseFinalRoutes(
    [
      'ignored preface',
      '[react m1: 🫡]',
      '[#howaclawa]: public note',
      'continued',
      '[dm]: private note',
      '[main_clawa]: ask main',
      '[quiet]',
    ].join('\n'),
  )

  assert.equal(routed.hasRoutes, true)
  assert.deepEqual(routed.blocks, [
    {
      target: { kind: 'channel', label: '#howaclawa' },
      text: '[react m1: 🫡]\npublic note\ncontinued',
    },
    { target: { kind: 'dm' }, text: 'private note' },
    { target: { kind: 'main-clawa' }, text: 'ask main' },
    { target: { kind: 'quiet' }, text: '' },
  ])
})

test('input sanitizer strips hidden controls without mangling normal text', () => {
  assert.equal(
    sanitizeDiscordText('hej\u200b clawa\u202e\nemoji 👨‍💻 café\r\n\u0000done'),
    'hej clawa\nemoji 👨‍💻 café\ndone',
  )
  assert.equal(sanitizeDiscordLabel('member-a\n\u202emember-b'), 'member-a member-b')
})

test('trigger removal does not strip incidental aliases', () => {
  assert.equal(
    stripAcceptedTrigger('@pi hello there', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
    }),
    'hello there',
  )
  assert.equal(
    stripAcceptedTrigger('hey clawa can you look?', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
      stripAlias: true,
    }),
    'hey can you look?',
  )
  assert.equal(
    stripAcceptedTrigger('clawa is already in this open-channel sentence', {
      triggerPattern: PRIMARY_TRIGGER_PATTERN,
      triggerAliasPattern: TRIGGER_ALIAS_PATTERN,
    }),
    'clawa is already in this open-channel sentence',
  )
})

test('gateway stop waits for the managed child to exit', async () => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    killed: boolean
    kill: (signal: NodeJS.Signals) => boolean
  }
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.kill = (signal) => {
    child.killed = true
    setImmediate(() => {
      child.signalCode = signal
      child.emit('exit', null, signal)
    })
    return true
  }

  setGatewayState({
    status: 'running-owned',
    projectRoot: '/test',
    lockPath: '/test/gateway.pid',
    process: child as never,
  })
  const stopping = stopGateway()
  assert.equal(getGatewayState().status, 'stopping')
  await stopping
  assert.deepEqual(getGatewayState(), { status: 'stopped' })
})

test('adopted gateway shutdown releases local state without killing the process', async () => {
  setGatewayState({
    status: 'running-adopted',
    projectRoot: '/test',
    lockPath: '/test/gateway.pid',
    lock: {
      pid: process.pid,
      projectRoot: '/test',
      entryPath: '/test/gateway',
      startedAt: new Date().toISOString(),
    },
  })
  await stopGateway({ stopAdopted: false })
  assert.deepEqual(getGatewayState(), { status: 'stopped' })
})

test('source-message deduplication survives schema migration', () => {
  const db = new Database(':memory:')
  try {
    db.exec(`
      create table message_queue (
        rowid integer primary key autoincrement,
        channel_jid text not null,
        sender text not null,
        sender_name text not null,
        source_message_id text,
        log_rowid integer,
        content text not null,
        timestamp text not null,
        status text not null default 'pending',
        created_at text not null default (datetime('now')),
        processed_at text
      );
      create table message_log (
        rowid integer primary key autoincrement,
        channel_jid text not null,
        role text not null,
        source_message_id text,
        content text not null,
        timestamp text not null default (datetime('now'))
      );
      insert into message_log
        (channel_jid, role, source_message_id, content)
      values
        ('dc:one', 'user', 'old-message', 'first'),
        ('dc:one', 'user', 'old-message', 'duplicate');
      insert into message_queue
        (channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, status)
      values
        ('dc:one', 'human', 'Human', 'old-message', 1, 'failed old delivery', datetime('now'), 'failed'),
        ('dc:one', 'human', 'Human', 'old-message', 2, 'pending replay', datetime('now'), 'pending');
    `)
    runSchemaMigrations(db)

    assert.equal(
      (db.prepare('select count(*) as count from message_queue').get() as { count: number }).count,
      1,
    )
    assert.equal(
      (db.prepare('select count(*) as count from message_log').get() as { count: number }).count,
      1,
    )
    assert.deepEqual(db.prepare('select content, log_rowid from message_queue').get(), {
      content: 'pending replay',
      log_rowid: 1,
    })

    const queueInsert = db.prepare(`
      insert into message_queue
        (channel_jid, sender, sender_name, source_message_id, content, timestamp)
      values (?, ?, ?, ?, ?, ?)
    `)
    queueInsert.run('dc:one', 'human', 'Human', 'message-1', 'hello', new Date().toISOString())
    assert.throws(() =>
      queueInsert.run(
        'dc:one',
        'human',
        'Human',
        'message-1',
        'hello again',
        new Date().toISOString(),
      ),
    )

    const logInsert = db.prepare(`
      insert into message_log
        (channel_jid, role, sender_id, sender_name, source_message_id, content)
      values (?, ?, ?, ?, ?, ?)
    `)
    logInsert.run('dc:one', 'user', 'human', 'Human', 'message-1', 'hello')
    assert.throws(() =>
      logInsert.run('dc:one', 'user', 'human', 'Human', 'message-1', 'hello again'),
    )
  } finally {
    db.close()
  }
})
