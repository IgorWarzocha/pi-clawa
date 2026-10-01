import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runSchemaMigrations } from './src/gateway/db/schema.js'

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
