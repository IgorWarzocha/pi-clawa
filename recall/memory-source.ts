import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolveMemoryDbPath } from '../memory.js'
import { includesAllTags, normalizeTags, scoreText } from './scoring.js'
import type { RecallResult, RecallSearchInput } from './types.js'

type MemoryRow = {
  id: number
  ts: number
  text: string
  tags: string
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : []
  } catch {
    return []
  }
}

export function searchMemory(input: RecallSearchInput, tokens: readonly string[]): RecallResult[] {
  const dbPath = resolveMemoryDbPath(input.cwd)
  if (!existsSync(dbPath)) return []

  const requiredTags = normalizeTags(input.tags)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare('SELECT id, ts, text, tags FROM memories ORDER BY ts DESC')
      .all() as MemoryRow[]
    return rows.flatMap((row): RecallResult[] => {
      const tags = parseTags(row.tags)
      if (!includesAllTags(tags, requiredTags)) return []
      const score = scoreText(row.text, tokens, tags)
      if (score <= 0) return []
      return [
        {
          source: 'memory',
          score: score + 2,
          timestamp: row.ts,
          text: row.text,
          tags,
          id: row.id,
          label: `mem #${row.id}`,
        },
      ]
    })
  } finally {
    db.close()
  }
}
