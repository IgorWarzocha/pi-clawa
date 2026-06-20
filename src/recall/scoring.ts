import type { RecallResult } from './types.js'

export const DEFAULT_RECALL_LIMIT = 10
export const MAX_RECALL_LIMIT = 25
export const MAX_SESSION_FILES = 20

const WORD_REGEX = /[\p{L}\p{N}_-]+/gu

export function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RECALL_LIMIT
  if (!Number.isFinite(limit)) return DEFAULT_RECALL_LIMIT
  return Math.max(1, Math.min(MAX_RECALL_LIMIT, Math.floor(limit)))
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase()
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  return Array.from(new Set((tags ?? []).map(normalizeTag).filter(Boolean)))
}

export function tokenize(query: string | undefined): string[] {
  return Array.from(new Set(query?.toLowerCase().match(WORD_REGEX) ?? []))
}

export function includesAllTags(
  candidate: readonly string[],
  required: readonly string[],
): boolean {
  if (required.length === 0) return true
  const normalized = new Set(candidate.map(normalizeTag))
  return required.every((tag) => normalized.has(tag))
}

export function scoreText(
  text: string,
  tokens: readonly string[],
  tags: readonly string[] = [],
): number {
  if (tokens.length === 0) return 1
  const haystack = `${text}\n${tags.join(' ')}`.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2
  }
  return score
}

export function compareResults(left: RecallResult, right: RecallResult): number {
  return right.score - left.score || right.timestamp - left.timestamp
}
