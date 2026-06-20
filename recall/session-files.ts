import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_SESSION_FILES } from './scoring.js'

function dedupeFiles(files: readonly string[]): string[] {
  return Array.from(new Set(files.filter(Boolean)))
}

function newestFirst(left: string, right: string): number {
  return statSync(right).mtimeMs - statSync(left).mtimeMs
}

export function discoverSessionFiles(ctx: {
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

export { dedupeFiles }
