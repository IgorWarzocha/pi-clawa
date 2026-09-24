import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

const HISTORY_DB_RELATIVE_PATH = '.pi/clawa-discord/gateway.db'
const DEFAULT_HISTORY_LIMIT = 10
export const MAX_HISTORY_LIMIT = 25

type DiscordHistoryRole = 'assistant' | 'reaction' | 'user'

export interface DiscordHistoryEntry {
  channelId: string
  channelName: string
  role: DiscordHistoryRole
  senderId: string
  senderName: string
  content: string
  timestamp: string
  sourceMessageId?: string | undefined
}

export interface DiscordHistorySearch {
  query?: string | undefined
  speaker?: string | undefined
  channel?: string | undefined
  role?: DiscordHistoryRole | undefined
  around?: number | undefined
  limit?: number | undefined
}

export interface DiscordHistoryResult {
  rowId: number
  channelId: string
  channelName: string
  role: DiscordHistoryRole
  senderName: string
  content: string
  timestamp: string
  timestampMs: number
  sourceMessageId?: string | undefined
  score: number
}

interface HistoryRow {
  rowid: number
  channel_jid: string
  channel_name: string
  role: DiscordHistoryRole
  sender_name: string
  content: string
  timestamp: string
  source_message_id: string | null
}

const CHANNEL_PREFIX = /^dc:/u
const SQL_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u

const WORDS = /[\p{L}\p{N}_-]+/gu

function resolveDiscordHistoryPath(projectRoot: string): string {
  return resolve(projectRoot, HISTORY_DB_RELATIVE_PATH)
}

export function archiveDiscordHistoryMessage(
  projectRoot: string,
  entry: DiscordHistoryEntry,
): void {
  const path = resolveDiscordHistoryPath(projectRoot)
  mkdirSync(dirname(path), { recursive: true })
  const db = openHistory(path)
  try {
    const channelJid = channelKey(entry.channelId)
    db.prepare(
      `INSERT INTO channels (jid, name)
       VALUES (?, ?)
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name`,
    ).run(channelJid, entry.channelName)

    if (entry.sourceMessageId) {
      const updated = db
        .prepare(
          `UPDATE message_log
           SET sender_id = ?, sender_name = ?, content = ?, timestamp = ?
           WHERE channel_jid = ? AND role = ? AND source_message_id = ?`,
        )
        .run(
          entry.senderId,
          entry.senderName,
          entry.content,
          entry.timestamp,
          channelJid,
          entry.role,
          entry.sourceMessageId,
        )
      if (updated.changes > 0) return
    }

    db.prepare(
      `INSERT INTO message_log
       (channel_jid, role, sender_id, sender_name, content, timestamp, source_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      channelJid,
      entry.role,
      entry.senderId,
      entry.senderName,
      entry.content,
      entry.timestamp,
      entry.sourceMessageId ?? null,
    )
  } finally {
    db.close()
  }
}

function updateDiscordHistoryMessage(
  projectRoot: string,
  sourceMessageId: string,
  content: string,
): void {
  const path = resolveDiscordHistoryPath(projectRoot)
  if (!existsSync(path)) return
  const db = openHistory(path)
  try {
    db.prepare(
      `UPDATE message_log SET content = ?
       WHERE source_message_id = ? AND role = 'user'`,
    ).run(content, sourceMessageId)
  } finally {
    db.close()
  }
}

export function markDiscordHistoryMessageDeleted(
  projectRoot: string,
  sourceMessageId: string,
): void {
  updateDiscordHistoryMessage(projectRoot, sourceMessageId, '[Deleted Discord message]')
}

export function searchDiscordHistory(
  projectRoot: string,
  input: DiscordHistorySearch,
): DiscordHistoryResult[] {
  const path = resolveDiscordHistoryPath(projectRoot)
  if (!existsSync(path)) return []
  const limit = normalizeHistoryLimit(input.limit)
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    if (input.around !== undefined) return searchAround(db, input.around, limit)

    const tokens = tokenizeHistoryQuery(input.query)
    const where: string[] = []
    const values: SQLInputValue[] = []
    if (input.role) {
      where.push('m.role = ?')
      values.push(input.role)
    } else {
      where.push("m.role IN ('user', 'assistant')")
    }
    for (const token of tokens) {
      where.push('instr(lower(m.content), ?) > 0')
      values.push(token)
    }
    if (input.speaker?.trim()) {
      where.push('instr(lower(m.sender_name), ?) > 0')
      values.push(input.speaker.trim().toLowerCase())
    }
    if (input.channel?.trim()) {
      where.push('instr(lower(coalesce(c.name, m.channel_jid)), ?) > 0')
      values.push(input.channel.trim().toLowerCase())
    }
    const candidateLimit = tokens.length > 0 ? Math.min(500, limit * 20) : limit
    values.push(candidateLimit)
    const rows = db
      .prepare(
        `SELECT m.rowid, m.channel_jid, coalesce(c.name, m.channel_jid) AS channel_name,
                m.role, m.sender_name, m.content, m.timestamp, m.source_message_id
         FROM message_log m
         LEFT JOIN channels c ON c.jid = m.channel_jid
         WHERE ${where.join(' AND ')}
         ORDER BY coalesce(julianday(m.timestamp), 0) DESC, m.rowid DESC
         LIMIT ?`,
      )
      .all(...values) as unknown as HistoryRow[]
    return rows
      .map((row) => toResult(row, scoreHistory(row.content, input.query, tokens)))
      .sort(compareHistory)
      .slice(0, limit)
  } finally {
    db.close()
  }
}

function normalizeHistoryLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(limit)))
}

function tokenizeHistoryQuery(query: string | undefined): string[] {
  return [...new Set(query?.toLowerCase().match(WORDS) ?? [])]
}

function openHistory(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = DELETE;
    CREATE TABLE IF NOT EXISTS channels (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_log (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_jid TEXT NOT NULL,
      role TEXT NOT NULL,
      sender_id TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      source_message_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_message_log_channel_rowid
      ON message_log(channel_jid, rowid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_log_discord_source
      ON message_log(channel_jid, role, source_message_id)
      WHERE source_message_id IS NOT NULL;
  `)
  return db
}

function searchAround(db: DatabaseSync, rowId: number, limit: number): DiscordHistoryResult[] {
  if (!Number.isSafeInteger(rowId) || rowId <= 0) {
    throw new Error('Discord history anchor must be a positive integer.')
  }
  const select = `SELECT m.rowid, m.channel_jid,
                         coalesce(c.name, m.channel_jid) AS channel_name,
                         m.role, m.sender_name, m.content, m.timestamp, m.source_message_id
                  FROM message_log m
                  LEFT JOIN channels c ON c.jid = m.channel_jid`
  const target = db.prepare(`${select} WHERE m.rowid = ?`).get(rowId) as HistoryRow | undefined
  if (!target) throw new Error(`No Discord history entry found at #${rowId}.`)

  const beforeLimit = Math.floor((limit - 1) / 2)
  const afterLimit = limit - beforeLimit - 1
  const before = db
    .prepare(
      `${select}
       WHERE m.channel_jid = ?
         AND (coalesce(julianday(m.timestamp), 0), m.rowid) < (coalesce(julianday(?), 0), ?)
         AND m.role IN ('user', 'assistant')
       ORDER BY coalesce(julianday(m.timestamp), 0) DESC, m.rowid DESC LIMIT ?`,
    )
    .all(target.channel_jid, target.timestamp, rowId, beforeLimit) as unknown as HistoryRow[]
  const after = db
    .prepare(
      `${select}
       WHERE m.channel_jid = ?
         AND (coalesce(julianday(m.timestamp), 0), m.rowid) > (coalesce(julianday(?), 0), ?)
         AND m.role IN ('user', 'assistant')
       ORDER BY coalesce(julianday(m.timestamp), 0) ASC, m.rowid ASC LIMIT ?`,
    )
    .all(target.channel_jid, target.timestamp, rowId, afterLimit) as unknown as HistoryRow[]
  return [...before.reverse(), target, ...after].map((row) =>
    toResult(row, row.rowid === rowId ? 4 : 1),
  )
}

function scoreHistory(
  content: string,
  query: string | undefined,
  tokens: readonly string[],
): number {
  if (tokens.length === 0) return 1
  const normalized = content.toLowerCase()
  const phrase = query?.trim().toLowerCase()
  return tokens.length * 2 + (phrase && normalized.includes(phrase) ? 3 : 0)
}

function toResult(row: HistoryRow, score: number): DiscordHistoryResult {
  return {
    rowId: row.rowid,
    channelId: row.channel_jid.replace(CHANNEL_PREFIX, ''),
    channelName: row.channel_name,
    role: row.role,
    senderName: row.sender_name,
    content: row.content,
    timestamp: row.timestamp,
    timestampMs: parseHistoryTimestamp(row.timestamp),
    sourceMessageId: row.source_message_id ?? undefined,
    score,
  }
}

function compareHistory(left: DiscordHistoryResult, right: DiscordHistoryResult): number {
  return (
    right.score - left.score || right.timestampMs - left.timestampMs || right.rowId - left.rowId
  )
}

function parseHistoryTimestamp(value: string): number {
  const normalized = SQL_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function channelKey(channelId: string): string {
  return `dc:${channelId}`
}
