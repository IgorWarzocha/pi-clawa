import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { compareResults, scoreText } from './scoring.js'
import type { RecallResult, SessionRole } from './types.js'

type SessionEntryRecord = Record<string, unknown> & {
  type?: string
  id?: string
  timestamp?: string
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

function buildRecallResult(
  entry: SessionEntryRecord,
  file: string,
  line: number,
  tokens: readonly string[],
): RecallResult | undefined {
  const extracted = extractSessionText(entry)
  if (!extracted) return undefined
  const score = scoreText(extracted.text, tokens)
  if (score <= 0) return undefined
  return {
    source: 'session',
    score: score + (extracted.role === 'compaction' ? 1 : 0),
    timestamp: sessionTimestamp(entry),
    text: extracted.text,
    sessionFile: file,
    line,
    entryId: typeof entry.id === 'string' ? entry.id : undefined,
    role: extracted.role,
    label: `session ${extracted.role}`,
  }
}

export async function searchSessionFile(
  file: string,
  tokens: readonly string[],
  limit: number,
): Promise<RecallResult[]> {
  if (!existsSync(file)) return []
  const results: RecallResult[] = []
  const lines = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let index = 0

  for await (const line of lines) {
    index += 1
    if (!line.trim()) continue
    const entry = parseSessionLine(line)
    if (!entry) continue
    const result = buildRecallResult(entry, file, index, tokens)
    if (!result) continue
    results.push(result)
    results.sort(compareResults)
    if (results.length > limit) results.length = limit
  }

  return results
}
