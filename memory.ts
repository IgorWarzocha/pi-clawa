import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { findRepoRoot } from './config.js'

const MEMORY_DB_RELATIVE_PATH = join('.pi', 'clawa-memory.sqlite')

export interface RememberMemoryInput {
  id?: number
  text: string
  tags?: string[]
}

export type RememberMemoryResult =
  | { action: 'created'; id: number; path: string }
  | { action: 'updated'; id: number; path: string }
  | { action: 'deleted'; id: number; path: string }

const MAX_TAG_LENGTH = 48
const MAX_TAGS = 12
const TAG_SAFE_REGEX = /[^a-z0-9:_-]+/g
const EDGE_DASH_REGEX = /^-+|-+$/g

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(TAG_SAFE_REGEX, '-').replace(EDGE_DASH_REGEX, '')
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  return Array.from(new Set(tags.map(normalizeTag).filter(Boolean))).slice(0, MAX_TAGS)
}

function normalizeId(id: number | undefined): number | undefined {
  if (id === undefined) return undefined
  if (!Number.isInteger(id) || id <= 0) throw new Error('Memory id must be a positive integer')
  return id
}

export function resolveMemoryDbPath(cwd: string): string {
  const root = process.env.PI_CLAW_PROJECT_ROOT?.trim() || findRepoRoot(cwd)
  return join(root, MEMORY_DB_RELATIVE_PATH)
}

function openMemoryDb(cwd: string): { db: DatabaseSync; path: string } {
  const path = resolveMemoryDbPath(cwd)
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      text TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS memories_ts_idx ON memories(ts);
  `)
  return { db, path }
}

function runDelete(db: DatabaseSync, id: number): void {
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id)
  if (result.changes === 0) throw new Error(`No memory found with id ${id}`)
}

function runUpdate(
  db: DatabaseSync,
  input: { id: number; ts: number; text: string; tags: string[] },
): void {
  const result = db
    .prepare('UPDATE memories SET ts = ?, text = ?, tags = ? WHERE id = ?')
    .run(input.ts, input.text, JSON.stringify(input.tags), input.id)
  if (result.changes === 0) throw new Error(`No memory found with id ${input.id}`)
}

function runInsert(db: DatabaseSync, input: { ts: number; text: string; tags: string[] }): number {
  const result = db
    .prepare('INSERT INTO memories (ts, text, tags) VALUES (?, ?, ?)')
    .run(input.ts, input.text, JSON.stringify(input.tags))
  return Number(result.lastInsertRowid)
}

export function rememberMemory(cwd: string, input: RememberMemoryInput): RememberMemoryResult {
  const id = normalizeId(input.id)
  const text = input.text.trim()
  const tags = normalizeTags(input.tags)
  if (!(id || text)) throw new Error('Memory text is empty. Pass an id with empty text to delete.')

  const { db, path } = openMemoryDb(cwd)
  try {
    if (id && !text) {
      runDelete(db, id)
      return { action: 'deleted', id, path }
    }

    const ts = Date.now()
    if (id) {
      runUpdate(db, { id, ts, text, tags })
      return { action: 'updated', id, path }
    }

    return { action: 'created', id: runInsert(db, { ts, text, tags }), path }
  } finally {
    db.close()
  }
}

function formatRememberResult(result: RememberMemoryResult): string {
  if (result.action === 'created') return `Remembered #${result.id}.`
  if (result.action === 'updated') return `Updated memory #${result.id}.`
  return `Deleted memory #${result.id}.`
}

export function registerRememberTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'remember',
    label: 'Remember',
    description:
      'Create, overwrite, or delete a short shared Clawa memory in the house SQLite memory. Use for raw/simple recall seeds; edit CLAW.md, HUMAN.md, CURIOUS.md, TOOLS.md, or AGENTS.md when the memory is shaped truth.',
    parameters: Type.Object({
      id: Type.Optional(
        Type.Number({
          description:
            'Existing memory id to overwrite. If id is set and text is empty, that memory is deleted.',
        }),
      ),
      text: Type.String({
        description:
          'Memory text. Non-empty creates or overwrites. Empty text with an id deletes that memory.',
      }),
      tags: Type.Optional(
        Type.Array(
          Type.String({
            maxLength: MAX_TAG_LENGTH,
            description: 'Small lowercase-ish tags like human, taste, curious, tool, correction.',
          }),
          { description: 'Optional short tags for later recall.' },
        ),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const result = rememberMemory(ctx.cwd, {
          id: typeof params.id === 'number' ? params.id : undefined,
          text: params.text,
          tags: Array.isArray(params.tags) ? params.tags : undefined,
        })
        return {
          content: [{ type: 'text' as const, text: formatRememberResult(result) }],
          details: result,
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        }
      }
    },
  })
}
