import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Edition } from './site'

export function readChangelog(edition: Edition): Promise<string> {
  const path = edition === 'modern' ? '../CHANGELOG.md' : '.generated/legacy/CHANGELOG.md'
  return readFile(resolve(process.cwd(), path), 'utf8')
}
