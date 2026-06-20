import { relative } from 'node:path'
import { findRepoRoot } from '../config.js'
import type { RecallResult } from './types.js'

const MAX_EXCERPT_CHARS = 500

function excerpt(text: string): string {
  const compact = text.replace(/\r?\n/g, ' ').replaceAll(/\s+/g, ' ').trim()
  if (compact.length <= MAX_EXCERPT_CHARS) return compact
  return `${compact.slice(0, MAX_EXCERPT_CHARS).trimEnd()}…`
}

function resultPath(result: RecallResult, cwd: string): string | undefined {
  if (!result.sessionFile) return undefined
  const repoRoot = findRepoRoot(cwd)
  const rel = relative(repoRoot, result.sessionFile)
  return rel && !rel.startsWith('..') ? rel : result.sessionFile
}

export function formatRecallResults(results: readonly RecallResult[], cwd: string): string {
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
