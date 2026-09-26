import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ListRevisionsInput, ReadRevisionInput } from './contracts.ts'
import { MaxFileBytes } from './contracts.ts'
import { normalizeFilePath } from './files.ts'
import { boundedRows } from './results.ts'

const exec = promisify(execFile)
const RevisionPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const RegularBlobPattern = /^100(?:644|755) blob [0-9a-f]+\t/
const TrailingNewlinePattern = /\n$/

export interface MemoryRevision {
  readonly revision: string
  readonly parents: readonly string[]
  readonly created_at: number
  readonly subject: string
  readonly paths: readonly string[]
  readonly paths_truncated: boolean
}

export async function listRevisions(
  rootHouse: string,
  input: ListRevisionsInput,
  signal: AbortSignal,
): Promise<{
  readonly available: boolean
  readonly revisions: readonly MemoryRevision[]
  readonly next_offset?: number
}> {
  const cwd = rootHouse
  const limit = input.limit ?? 10
  const offset = input.offset ?? 0
  validateListBounds(limit, offset, input.query)
  const prefix = await repositoryPrefix(cwd, signal)
  if (prefix === undefined) return { available: false, revisions: [] }
  const path = input.path === undefined ? 'memory/' : `memory/${normalizeFilePath(input.path)}`
  const raw = await git(
    cwd,
    [
      'log',
      '--all',
      '--format=%H%x00%P%x00%ct%x00%s',
      '-z',
      `--max-count=${limit + 1}`,
      `--skip=${offset}`,
      ...(input.query === undefined ? [] : ['-S', input.query]),
      '--',
      `:(literal)${path}`,
    ],
    signal,
  )
  const fields = raw.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 4 !== 0) throw new Error('Git returned invalid memory revisions')
  const revisions: MemoryRevision[] = []
  for (let index = 0; index < Math.min(fields.length, limit * 4); index += 4) {
    revisions.push(await revisionRow(cwd, prefix, path, fields, index, signal))
  }
  return {
    available: true,
    revisions,
    ...(fields.length / 4 > limit ? { next_offset: offset + limit } : {}),
  }
}

function validateListBounds(limit: number, offset: number, query: string | undefined) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (query !== undefined && (query.length === 0 || query.length > 160))
  ) {
    throw new Error('Invalid revision list bounds')
  }
}

async function revisionRow(
  cwd: string,
  prefix: string,
  path: string,
  fields: string[],
  index: number,
  signal: AbortSignal,
): Promise<MemoryRevision> {
  const revision = fields[index] ?? ''
  if (!RevisionPattern.test(revision)) throw new Error('Git returned an invalid revision')
  const changed = await git(
    cwd,
    [
      'diff-tree',
      '--root',
      '-m',
      '--no-commit-id',
      '--name-only',
      '-r',
      '-z',
      revision,
      '--',
      `:(literal)${path}`,
    ],
    signal,
  )
  const paths = boundedRows(
    [
      ...new Set(
        changed
          .split('\0')
          .filter(
            (name) => name.startsWith(`${prefix}memory/`) && name.toLowerCase().endsWith('.md'),
          )
          .map((name) => name.slice(prefix.length)),
      ),
    ],
    4_000,
  )
  return {
    revision,
    parents: (fields[index + 1] ?? '').split(' ').filter(Boolean),
    created_at: Number(fields[index + 2]) * 1_000,
    subject: (fields[index + 3] ?? '').slice(0, 512),
    paths: paths.rows,
    paths_truncated: paths.truncated,
  }
}

export async function readRevision(
  rootHouse: string,
  input: ReadRevisionInput,
  signal: AbortSignal,
) {
  const cwd = rootHouse
  const offset = input.offset_chars ?? 0
  const limit = input.limit_chars ?? 4_000
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 8_000
  ) {
    throw new Error('Invalid revision read bounds')
  }
  if (!RevisionPattern.test(input.revision)) throw new Error('Pass the full revision ID')
  const prefix = await repositoryPrefix(cwd, signal)
  if (prefix === undefined) throw new Error('Workspace is not a Git repository')
  const path = `memory/${normalizeFilePath(input.path)}`
  const objectPath = `${prefix}${path}`
  const type = (await git(cwd, ['cat-file', '-t', input.revision], signal)).trim()
  if (type !== 'commit') throw new Error('Memory revision must identify a commit')
  const entry = await git(
    cwd,
    ['ls-tree', '--full-tree', '-z', input.revision, '--', objectPath],
    signal,
  )
  if (!RegularBlobPattern.test(entry) || entry.split('\0').length !== 2) {
    throw new Error('Revision does not contain a regular memory file at this path')
  }
  const object = `${input.revision}:${objectPath}`
  const size = Number((await git(cwd, ['cat-file', '-s', object], signal)).trim())
  if (!Number.isSafeInteger(size) || size < 0 || size > MaxFileBytes) {
    throw new Error('Historical memory file exceeds the file-size limit')
  }
  const full = await git(cwd, ['cat-file', 'blob', object], signal)
  const content = full.slice(offset, offset + limit)
  return {
    path,
    revision: input.revision,
    content,
    offset_chars: offset,
    total_chars: full.length,
    truncated: offset + content.length < full.length,
  }
}

async function repositoryPrefix(cwd: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return (await git(cwd, ['rev-parse', '--show-prefix'], signal)).replace(
      TrailingNewlinePattern,
      '',
    )
  } catch (error) {
    if (
      error instanceof Error &&
      'stderr' in error &&
      (typeof error.stderr === 'string' || Buffer.isBuffer(error.stderr)) &&
      error.stderr.toString().includes('not a git repository')
    )
      return undefined
    throw error
  }
}

async function git(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  const result = await exec('git', ['--no-pager', ...args], {
    cwd,
    signal,
    encoding: 'buffer',
    timeout: 15_000,
    maxBuffer: MaxFileBytes + 65_536,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  })
  return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)
}
