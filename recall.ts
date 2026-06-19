import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { findRepoRoot } from './config.js'
import { resolveMemoryDbPath } from './memory.js'

type RecallSource = 'memory' | 'session'
type SessionRole = 'user' | 'assistant' | 'custom' | 'compaction' | 'branch'

interface RecallQuery {
  query?: string
  tags?: string[]
  limit?: number
}

export interface RecallSearchInput extends RecallQuery {
  cwd: string
  sessionFiles?: string[]
}

export interface RecallResult {
  source: RecallSource
  score: number
  timestamp: number
  text: string
  tags?: string[]
  id?: number
  sessionFile?: string
  line?: number
  entryId?: string
  role?: SessionRole
  label: string
}

type MemoryRow = {
  id: number
  ts: number
  text: string
  tags: string
}

type SessionEntryRecord = Record<string, unknown> & {
  type?: string
  id?: string
  timestamp?: string
}

const DEFAULT_RECALL_LIMIT = 10
const MAX_RECALL_LIMIT = 25
const MAX_SESSION_FILES = 20
const MAX_EXCERPT_CHARS = 500
const WORD_REGEX = /[\p{L}\p{N}_-]+/gu
const LINE_SPLIT_REGEX = /\r?\n/

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RECALL_LIMIT
  if (!Number.isFinite(limit)) return DEFAULT_RECALL_LIMIT
  return Math.max(1, Math.min(MAX_RECALL_LIMIT, Math.floor(limit)))
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase()
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map(normalizeTag).filter(Boolean)))
}

function tokenize(query: string | undefined): string[] {
  return Array.from(new Set(query?.toLowerCase().match(WORD_REGEX) ?? []))
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

function includesAllTags(candidate: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true
  const normalized = new Set(candidate.map(normalizeTag))
  return required.every((tag) => normalized.has(tag))
}

function scoreText(text: string, tokens: readonly string[], tags: readonly string[] = []): number {
  if (tokens.length === 0) return 1
  const haystack = `${text}\n${tags.join(' ')}`.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2
  }
  return score
}

function compareResults(left: RecallResult, right: RecallResult): number {
  return right.score - left.score || right.timestamp - left.timestamp
}

function excerpt(text: string): string {
  const compact = text.replace(/\r?\n/g, ' ').replaceAll(/\s+/g, ' ').trim()
  if (compact.length <= MAX_EXCERPT_CHARS) return compact
  return `${compact.slice(0, MAX_EXCERPT_CHARS).trimEnd()}…`
}

function searchMemory(input: RecallSearchInput, tokens: readonly string[]): RecallResult[] {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function extractTextContent(content: unknown, assistant = false): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .flatMap((part): string[] => {
      const record = asRecord(part)
      if (!record) return []
      if (record.type !== 'text') return []
      return typeof record.text === 'string' ? [record.text.trim()] : []
    })
    .filter(Boolean)
    .join(assistant ? '\n' : '\n')
}

function extractedSessionText(
  role: SessionRole,
  text: string,
): { role: SessionRole; text: string } | null {
  const trimmed = text.trim()
  return trimmed ? { role, text: trimmed } : null
}

function extractMessageEntry(
  entry: SessionEntryRecord,
): { role: SessionRole; text: string } | null {
  const message = asRecord(entry.message)
  if (message?.role === 'user')
    return extractedSessionText('user', extractTextContent(message.content))
  if (message?.role === 'assistant') {
    return extractedSessionText('assistant', extractTextContent(message.content, true))
  }
  return null
}

function extractCustomMessageEntry(
  entry: SessionEntryRecord,
): { role: SessionRole; text: string } | null {
  const text = extractTextContent(entry.content)
  const customType = typeof entry.customType === 'string' ? `[${entry.customType}] ` : ''
  return extractedSessionText('custom', `${customType}${text}`)
}

function extractSessionText(entry: SessionEntryRecord): { role: SessionRole; text: string } | null {
  if (entry.type === 'message') return extractMessageEntry(entry)
  if (entry.type === 'custom_message') return extractCustomMessageEntry(entry)
  if (entry.type === 'compaction' && typeof entry.summary === 'string') {
    return extractedSessionText('compaction', entry.summary)
  }
  if (entry.type === 'branch_summary' && typeof entry.summary === 'string') {
    return extractedSessionText('branch', entry.summary)
  }
  return null
}

function parseSessionLine(line: string): SessionEntryRecord | null {
  try {
    const parsed = JSON.parse(line) as unknown
    const record = asRecord(parsed)
    return record ? (record as SessionEntryRecord) : null
  } catch {
    return null
  }
}

function sessionTimestamp(entry: SessionEntryRecord): number {
  if (typeof entry.timestamp !== 'string') return 0
  const timestamp = new Date(entry.timestamp).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function searchSessionFile(file: string, tokens: readonly string[]): RecallResult[] {
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(LINE_SPLIT_REGEX)
  const results: RecallResult[] = []

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const entry = parseSessionLine(line)
    if (!entry) continue
    const extracted = extractSessionText(entry)
    if (!extracted) continue
    const score = scoreText(extracted.text, tokens)
    if (score <= 0) continue
    results.push({
      source: 'session',
      score: score + (extracted.role === 'compaction' ? 1 : 0),
      timestamp: sessionTimestamp(entry),
      text: extracted.text,
      sessionFile: file,
      line: index + 1,
      entryId: typeof entry.id === 'string' ? entry.id : undefined,
      role: extracted.role,
      label: `session ${extracted.role}`,
    })
  }

  return results
}

function dedupeFiles(files: readonly string[]): string[] {
  return Array.from(new Set(files.filter(Boolean)))
}

export function searchRecall(input: RecallSearchInput): RecallResult[] {
  const tokens = tokenize(input.query)
  const limit = normalizeLimit(input.limit)
  const memoryResults = searchMemory(input, tokens)
  const sessionResults = dedupeFiles(input.sessionFiles ?? []).flatMap((file) =>
    searchSessionFile(file, tokens),
  )
  return [...memoryResults, ...sessionResults].sort(compareResults).slice(0, limit)
}

function resultPath(result: RecallResult, cwd: string): string | undefined {
  if (!result.sessionFile) return undefined
  const repoRoot = findRepoRoot(cwd)
  const rel = relative(repoRoot, result.sessionFile)
  return rel && !rel.startsWith('..') ? rel : result.sessionFile
}

function formatRecallResults(results: readonly RecallResult[], cwd: string): string {
  if (results.length === 0) return 'No matching memories or session entries found.'

  return results
    .map((result, index) => {
      if (result.source === 'memory') {
        const tags = result.tags && result.tags.length > 0 ? ` [${result.tags.join(',')}]` : ''
        return `${index + 1}. [mem #${result.id}]${tags}\n${excerpt(result.text)}`
      }

      const path = resultPath(result, cwd)
      const loc = [path, result.line ? `line ${result.line}` : null, result.entryId ?? null]
        .filter(Boolean)
        .join(' · ')
      return `${index + 1}. [${result.role}] ${loc}\n${excerpt(result.text)}`
    })
    .join('\n\n')
}

function newestFirst(left: string, right: string): number {
  return statSync(right).mtimeMs - statSync(left).mtimeMs
}

function discoverSessionFiles(ctx: {
  sessionManager?: { getSessionFile(): string | undefined; getSessionDir(): string }
}): string[] {
  const files: string[] = []
  const activeFile = ctx.sessionManager?.getSessionFile()
  if (activeFile) files.push(activeFile)

  const sessionDir = ctx.sessionManager?.getSessionDir()
  if (sessionDir && existsSync(sessionDir)) {
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(sessionDir, entry.name))
    }
  }

  return dedupeFiles(files).sort(newestFirst).slice(0, MAX_SESSION_FILES)
}

export function registerRecallTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'recall',
    label: 'Recall',
    description:
      'Search shared Clawa memories plus this Clawa session transcript. Session recall only reads user messages, assistant text, custom messages, compactions, and branch summaries; it skips tool calls and tool results.',
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: 'Words to search for in shared memory and this Clawa session.',
        }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Memory tags to filter shared SQLite memories by. Session entries do not have tags.',
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: `Maximum results, default ${DEFAULT_RECALL_LIMIT}, cap ${MAX_RECALL_LIMIT}.`,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const results = searchRecall({
          cwd: ctx.cwd,
          query: typeof params.query === 'string' ? params.query : undefined,
          tags: Array.isArray(params.tags) ? params.tags : undefined,
          limit: typeof params.limit === 'number' ? params.limit : undefined,
          sessionFiles: discoverSessionFiles(ctx),
        })
        return {
          content: [{ type: 'text' as const, text: formatRecallResults(results, ctx.cwd) }],
          details: { count: results.length, results },
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
