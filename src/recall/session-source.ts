import { existsSync, readFileSync } from 'node:fs'
import { scoreText } from './scoring.js'
import type { RecallResult, SessionRole } from './types.js'

type SessionEntryRecord = Record<string, unknown> & {
  type?: string
  id?: string
  timestamp?: string
}

const LINE_SPLIT_REGEX = /\r?\n/

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
      if (record['type'] !== 'text') return []
      return typeof record['text'] === 'string' ? [record['text'].trim()] : []
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
  const message = asRecord(entry['message'])
  if (message?.['role'] === 'user') {
    return extractedSessionText('user', extractTextContent(message['content']))
  }
  if (message?.['role'] === 'assistant') {
    return extractedSessionText('assistant', extractTextContent(message['content'], true))
  }
  return null
}

function extractCustomMessageEntry(
  entry: SessionEntryRecord,
): { role: SessionRole; text: string } | null {
  const text = extractTextContent(entry['content'])
  const customType = typeof entry['customType'] === 'string' ? `[${entry['customType']}] ` : ''
  return extractedSessionText('custom', `${customType}${text}`)
}

function extractSessionText(entry: SessionEntryRecord): { role: SessionRole; text: string } | null {
  if (entry.type === 'message') return extractMessageEntry(entry)
  if (entry.type === 'custom_message') return extractCustomMessageEntry(entry)
  if (entry.type === 'compaction' && typeof entry['summary'] === 'string') {
    return extractedSessionText('compaction', entry['summary'])
  }
  if (entry.type === 'branch_summary' && typeof entry['summary'] === 'string') {
    return extractedSessionText('branch', entry['summary'])
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

export function searchSessionFile(file: string, tokens: readonly string[]): RecallResult[] {
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
