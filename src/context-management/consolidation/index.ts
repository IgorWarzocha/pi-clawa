import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { withWriteLock } from '../files/write-lock.js'

export interface ConsolidationSource {
  sessionFile: string
  leafId: string
  chatId: string
  agentName: string
  cwd: string
  model: { provider: string; id: string }
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface ConsolidationJob extends ConsolidationSource {
  id: string
  rootHouse: string
  sessionId: string
  status: 'queued' | 'running' | 'remembered' | 'failed'
  attempts: number
  createdAt: number
  updatedAt: number
  error: string | null
}

export type ConsolidationRunner = (job: ConsolidationJob, signal: AbortSignal) => Promise<void>

function openQueue(rootHouse: string): DatabaseSync {
  const directory = join(rootHouse, '.pi', 'context')
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'consolidation.sqlite'))
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(`CREATE TABLE IF NOT EXISTS consolidation_jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    session_file TEXT NOT NULL,
    leaf_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','remembered','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    error TEXT,
    UNIQUE(session_file, leaf_id)
  )`)
  return db
}

function withQueue<T>(rootHouse: string, operation: (db: DatabaseSync) => T): T {
  const db = openQueue(rootHouse)
  try {
    return operation(db)
  } finally {
    db.close()
  }
}

type Row = {
  id: string
  source: string
  status: ConsolidationJob['status']
  attempts: number
  created_at: number
  updated_at: number
  error: string | null
}

function jobFromRow(rootHouse: string, row: Row): ConsolidationJob {
  const parsed: unknown = JSON.parse(row.source)
  if (!isStoredSource(parsed)) throw new Error(`Invalid persisted memory source for job ${row.id}`)
  return {
    ...parsed,
    id: row.id,
    rootHouse,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
  }
}

function isStoredSource(value: unknown): value is ConsolidationSource & { sessionId: string } {
  if (value === null || typeof value !== 'object') return false
  const source = value as Record<string, unknown>
  const model = source['model']
  const hasText = (text: unknown): text is string => typeof text === 'string' && text.length > 0
  return (
    ['sessionFile', 'leafId', 'chatId', 'agentName', 'cwd', 'sessionId'].every((field) =>
      hasText(source[field]),
    ) &&
    model !== null &&
    typeof model === 'object' &&
    hasText((model as Record<string, unknown>)['provider']) &&
    hasText((model as Record<string, unknown>)['id']) &&
    (source['thinkingLevel'] === undefined ||
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
        String(source['thinkingLevel']),
      ))
  )
}

export function enqueue(rootHouse: string, source: ConsolidationSource): string {
  if (!isStoredSource({ ...source, sessionId: 'pending' }))
    throw new Error('Memory source needs valid session, chat, Clawa, cwd, and model metadata')
  const manager = SessionManager.open(source.sessionFile)
  const header = manager.getHeader()
  if (header?.id !== source.chatId || resolve(header.cwd) !== resolve(source.cwd))
    throw new Error(
      `Memory source chat or cwd does not match session header: ${source.sessionFile}`,
    )
  if (!manager.getEntry(source.leafId))
    throw new Error(`Memory source leaf not found: ${source.leafId}`)
  const persistedSource = { ...source, sessionId: manager.getSessionId() }
  return withQueue(rootHouse, (db) => {
    const id = randomUUID()
    const now = Date.now()
    const result = db
      .prepare(`INSERT OR IGNORE INTO consolidation_jobs (id,source,session_file,leaf_id,status,created_at,updated_at)
      VALUES (?,?,?,?, 'queued',?,?)`)
      .run(id, JSON.stringify(persistedSource), source.sessionFile, source.leafId, now, now)
    if (result.changes) return id
    const existing = db
      .prepare('SELECT id FROM consolidation_jobs WHERE session_file = ? AND leaf_id = ?')
      .get(source.sessionFile, source.leafId) as { id: string } | undefined
    if (!existing) throw new Error('Memory job could not be queued')
    return existing.id
  })
}

export function listJobs(rootHouse: string): ConsolidationJob[] {
  return withQueue(rootHouse, (db) =>
    (db.prepare('SELECT * FROM consolidation_jobs ORDER BY created_at, rowid').all() as Row[]).map(
      (row) => jobFromRow(rootHouse, row),
    ),
  )
}

export function retryJob(rootHouse: string, id: string): void {
  withQueue(rootHouse, (db) => {
    const result = db
      .prepare(`UPDATE consolidation_jobs SET status='queued', error=NULL, updated_at=?
      WHERE id=? AND status='failed'`)
      .run(Date.now(), id)
    if (!result.changes) throw new Error(`No failed memory job with id ${id}`)
  })
}

/** The OS lock covers recovery, claims, model work, and settlement. Other consumers wait. */
export async function drain(
  rootHouse: string,
  runner: ConsolidationRunner,
  signal: AbortSignal,
): Promise<void> {
  const lock = join(rootHouse, '.pi', 'context', 'consolidation-lock')
  mkdirSync(lock, { recursive: true })
  await withWriteLock(lock, signal, async () => {
    withQueue(rootHouse, (db) =>
      db
        .prepare(
          `UPDATE consolidation_jobs SET status='queued', updated_at=? WHERE status='running'`,
        )
        .run(Date.now()),
    )
    while (!signal.aborted) {
      const job = withQueue(rootHouse, (db) => {
        const row = db
          .prepare(`SELECT * FROM consolidation_jobs WHERE status='queued'
          ORDER BY created_at, rowid LIMIT 1`)
          .get() as Row | undefined
        if (!row) return undefined
        db.prepare(`UPDATE consolidation_jobs SET status='running', attempts=attempts+1,
          updated_at=? WHERE id=? AND status='queued'`).run(Date.now(), row.id)
        return {
          ...jobFromRow(rootHouse, row),
          status: 'running' as const,
          attempts: row.attempts + 1,
        }
      })
      if (!job) return
      let failure: unknown
      let completed = false
      try {
        await runner(job, signal)
        completed = true
      } catch (cause) {
        failure = cause
      }
      const interrupted = signal.aborted
      withQueue(rootHouse, (db) =>
        db
          .prepare(`UPDATE consolidation_jobs SET status=?,error=?,updated_at=?
        WHERE id=? AND status='running' AND attempts=?`)
          .run(
            interrupted ? 'queued' : completed ? 'remembered' : 'failed',
            interrupted || completed ? null : String(failure),
            Date.now(),
            job.id,
            job.attempts,
          ),
      )
    }
  })
}
