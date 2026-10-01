import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { DiscordArchive } from './src/discord/archive.js'
import { type DiscordHistoryEntry, searchDiscordHistory } from './src/discord/history.js'

const PENDING = /3 pending/u
const ARCHIVE_FAILED = /Archive failed/u
const CORRUPT_JOURNAL = /Invalid Discord archive journal/u

const entry: DiscordHistoryEntry = {
  channelId: '900',
  channelName: '#room',
  role: 'user',
  senderId: '800',
  senderName: 'Human',
  content: 'original',
  timestamp: '2026-09-24T10:00:00Z',
  sourceMessageId: '1',
}

test('the old gateway database accepts new history without changing legacy state', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-discord-upgrade-'))
  const health: Array<string | undefined> = []
  try {
    const directory = join(root, '.pi/clawa-discord')
    mkdirSync(directory, { recursive: true })
    const database = join(directory, 'gateway.db')
    const old = new DatabaseSync(database)
    try {
      old.exec(`
        CREATE TABLE channels (
          jid TEXT PRIMARY KEY, name TEXT NOT NULL,
          requires_trigger INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE message_log (
          rowid INTEGER PRIMARY KEY AUTOINCREMENT, channel_jid TEXT NOT NULL,
          role TEXT NOT NULL, sender_id TEXT NOT NULL DEFAULT '',
          sender_name TEXT NOT NULL DEFAULT '', source_message_id TEXT,
          content TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO channels (jid, name, requires_trigger) VALUES ('dc:900', '#old-room', 0);
        INSERT INTO message_log (channel_jid, role, source_message_id, content, timestamp)
          VALUES ('dc:900', 'user', '0', 'from gateway', '2026-09-23 10:00:00');
      `)
    } finally {
      old.close()
    }
    const archive = new DiscordArchive(root, (failure) => health.push(failure))
    archive.archive(entry)
    archive.archive({ ...entry, channelId: '901', sourceMessageId: '2', content: 'new room' })
    assert.ok(health.length > 0 && health.every((failure) => failure === undefined))
    assert.deepEqual(
      searchDiscordHistory(root, {}).map((result) => result.content),
      ['new room', 'original', 'from gateway'],
    )
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'archive-pending.json'), 'utf8')), [])
    const reopened = new DatabaseSync(database, { readOnly: true })
    try {
      assert.equal(
        reopened.prepare("SELECT requires_trigger FROM channels WHERE jid = 'dc:900'").get()?.[
          'requires_trigger'
        ],
        0,
      )
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed archive writes survive restart and replay edits and deletes in order', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-discord-history-'))
  const health: Array<string | undefined> = []
  try {
    const database = join(root, '.pi/clawa-discord/gateway.db')
    mkdirSync(database, { recursive: true })
    const archive = new DiscordArchive(root, (failure) => health.push(failure))
    archive.archive(entry)
    archive.archive({ ...entry, content: 'edited' })
    archive.delete('1')
    assert.match(health.at(-1) ?? '', PENDING)
    const journal = join(root, '.pi/clawa-discord/archive-pending.json')
    assert.equal(JSON.parse(readFileSync(journal, 'utf8')).length, 3)
    rmSync(database, { recursive: true })
    const recovered = new DiscordArchive(root, (failure) => health.push(failure))
    recovered.flush()
    assert.equal(health.at(-1), undefined)
    const history = searchDiscordHistory(root, {})
    assert.equal(history.length, 1)
    assert.equal(history[0]?.content, '[Deleted Discord message]')
    recovered.flush()
    assert.equal(searchDiscordHistory(root, {}).length, 1)
    assert.deepEqual(JSON.parse(readFileSync(journal, 'utf8')), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed journal write is visible and retryable, while a corrupt journal blocks startup', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawa-discord-journal-'))
  const health: Array<string | undefined> = []
  try {
    writeFileSync(join(root, '.pi'), 'blocked')
    const archive = new DiscordArchive(root, (failure) => health.push(failure))
    assert.throws(() => archive.archive(entry))
    assert.match(health.at(-1) ?? '', ARCHIVE_FAILED)
    rmSync(join(root, '.pi'))
    archive.flush()
    assert.equal(health.at(-1), undefined)
    assert.equal(searchDiscordHistory(root, {})[0]?.content, 'original')
    const path = join(root, '.pi/clawa-discord/archive-pending.json')
    writeFileSync(path, '[{"entry":{}}]')
    assert.throws(() => new DiscordArchive(root, () => {}), CORRUPT_JOURNAL)
    assert.equal(readFileSync(path, 'utf8'), '[{"entry":{}}]')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
