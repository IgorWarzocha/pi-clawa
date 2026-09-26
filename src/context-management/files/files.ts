import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import {
  type ChangeFileInput,
  type ListFilesInput,
  MaxFileBytes,
  MaxSearchFiles,
  MaxToolOutputBytes,
  type ReadFileInput,
  type SearchContentsInput,
} from './contracts.ts'
import { jsonBytes, truncateSearchLine, utf8Prefix } from './results.ts'
import {
  contentRoot,
  discoverFiles,
  loadFile,
  relativeDisplayPath,
  replaceFile,
  type StoredFile,
  throwIfAborted,
} from './storage.ts'
import { withWriteLock } from './write-lock.ts'

const decoder = new TextDecoder('utf-8', { fatal: true })

interface FileMetadata {
  readonly path: string
  readonly bytes: number
  readonly created_at: string
  readonly updated_at: string
}

export interface ReadResult {
  readonly truncated: boolean
  readonly file: FileMetadata & {
    readonly content: string
    readonly version: string
    readonly start_line: number
    readonly stop_line: number
    readonly total_lines: number
  }
}

export interface ListResult {
  readonly files: readonly FileMetadata[]
  readonly returned_files: number
  readonly truncated: boolean
}

interface SearchMatch {
  readonly line_number: number
  readonly line: string
  readonly truncated?: true
}

interface SearchFile {
  readonly path: string
  readonly matches: readonly SearchMatch[]
}

export interface SearchResult {
  readonly results: readonly SearchFile[]
  readonly returned_files: number
  readonly truncated: boolean
}

export async function listFiles(
  rootInput: string,
  input: ListFilesInput,
  signal: AbortSignal,
): Promise<ListResult> {
  const root = await contentRoot(rootInput)
  const discovered = await discoverFiles(root, signal)
  const prefix = normalizePrefix(input.prefix)
  const matching = discovered.files.filter((file) => file.relativePath.startsWith(prefix))
  const direction = input.file_order === 'descending' ? -1 : 1
  const orderBy = input.file_order_by ?? 'name'
  matching.sort((left, right) => {
    const comparison =
      orderBy === 'name'
        ? left.relativePath.localeCompare(right.relativePath)
        : orderBy === 'created_at'
          ? left.createdAt - right.createdAt
          : left.updatedAt - right.updatedAt
    return comparison * direction
  })
  const limit = input.max_results ?? 20
  const files: FileMetadata[] = []
  for (const file of matching.slice(0, limit)) {
    const candidate = [...files, publicMetadata(file)]
    if (
      jsonBytes({ files: candidate, returned_files: candidate.length, truncated: true }) >
      MaxToolOutputBytes
    )
      break
    files.push(publicMetadata(file))
  }
  return {
    files,
    returned_files: files.length,
    truncated: discovered.truncated || matching.length > files.length,
  }
}

export async function readFile(
  rootInput: string,
  input: ReadFileInput,
  signal: AbortSignal,
): Promise<ReadResult> {
  const root = await contentRoot(rootInput)
  const relativePath = normalizeFilePath(input.path)
  const loaded = await loadRequiredFile(root, relativePath, signal)
  const lines = loaded.text.split('\n')
  const start = lineIndex(input.start_line, lines.length, 0)
  const stop = lineIndex(input.stop_line, lines.length, lines.length - 1)
  const file = {
    ...publicMetadata(loaded.file),
    version: loaded.version,
    content: start <= stop ? lines.slice(start, stop + 1).join('\n') : '',
    start_line: start + 1,
    stop_line: Math.max(start, stop) + 1,
    total_lines: lines.length,
  }
  if (jsonBytes({ file, truncated: false }) <= MaxToolOutputBytes) return { file, truncated: false }
  let lower = 0
  let upper = Buffer.byteLength(file.content, 'utf8')
  let bounded = ''
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2)
    const content = utf8Prefix(file.content, middle)
    if (jsonBytes({ file: { ...file, content }, truncated: true }) <= MaxToolOutputBytes) {
      bounded = content
      lower = middle + 1
    } else upper = middle - 1
  }
  return { file: { ...file, content: bounded }, truncated: true }
}

export async function searchFiles(
  rootInput: string,
  input: SearchContentsInput,
  signal: AbortSignal,
): Promise<SearchResult> {
  const root = await contentRoot(rootInput)
  const discovered = await discoverFiles(root, signal)
  const prefix = normalizePrefix(input.path_prefix)
  const candidates = discovered.files.filter((file) => file.relativePath.startsWith(prefix))
  candidates.sort(
    input.recent_file_first === true
      ? (left, right) =>
          right.updatedAt - left.updatedAt || left.relativePath.localeCompare(right.relativePath)
      : (left, right) => left.relativePath.localeCompare(right.relativePath),
  )

  const fileLimit = input.max_files ?? 20
  const matchLimit = input.max_matches_per_file ?? 20
  const scannedCandidates = candidates.slice(0, MaxSearchFiles)
  const loadedCandidates = await Promise.all(
    scannedCandidates.map(async (candidate) => ({
      candidate,
      text: (await loadRequiredFile(root, candidate.relativePath, signal)).text,
    })),
  )
  const results: SearchFile[] = []
  let truncated = discovered.truncated || scannedCandidates.length < candidates.length
  for (const loaded of loadedCandidates) {
    throwIfAborted(signal)
    if (results.length >= fileLimit) {
      truncated = true
      break
    }
    const found = searchLines(loaded.text, input.query, matchLimit)
    const bounded = boundedSearchMatches(results, loaded.candidate.path, found.matches)
    truncated ||= found.truncated || bounded.truncated
    if (bounded.matches.length > 0)
      results.push({ path: loaded.candidate.path, matches: bounded.matches })
    if (bounded.overflow) break
  }
  return { results, returned_files: results.length, truncated }
}

function boundedSearchMatches(
  results: readonly SearchFile[],
  path: string,
  incoming: readonly SearchMatch[],
) {
  const matches: SearchMatch[] = []
  let truncated = false
  for (const match of incoming) {
    const candidate = [...results, { path, matches: [...matches, match] }]
    if (
      jsonBytes({ results: candidate, returned_files: candidate.length, truncated: true }) >
      MaxToolOutputBytes
    ) {
      return { matches, truncated: true, overflow: true }
    }
    matches.push(match)
    if (match.truncated) truncated = true
  }
  return { matches, truncated, overflow: false }
}

function searchLines(text: string, query: string, limit: number) {
  const matches: SearchMatch[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined || !line.includes(query)) continue
    if (matches.length >= limit) return { matches, truncated: true }
    const bounded = truncateSearchLine(line, query, 4_096)
    matches.push({
      line_number: index + 1,
      line: bounded.text,
      ...(bounded.truncated ? { truncated: true as const } : {}),
    })
  }
  return { matches, truncated: false }
}

export async function writeFile(
  rootInput: string,
  input: ChangeFileInput,
  signal: AbortSignal,
): Promise<string> {
  const root = await contentRoot(rootInput)
  const relativePath = normalizeFilePath(input.path)
  const content = encodeBounded(input.text)
  await withWriteLock(root, signal, async () => {
    if (input.expected_version !== undefined) {
      const existing = await loadForChange(root, relativePath, signal)
      checkVersion(existing?.bytes, input.expected_version)
    }
    await replaceFile(root, relativePath, content)
  })
  return relativeDisplayPath(relativePath)
}

export async function appendFile(
  rootInput: string,
  input: ChangeFileInput,
  signal: AbortSignal,
): Promise<string> {
  const root = await contentRoot(rootInput)
  const relativePath = normalizeFilePath(input.path)
  const addition = encodeBounded(input.text)
  await withWriteLock(root, signal, async () => {
    const existing = await loadForChange(root, relativePath, signal)
    checkVersion(existing?.bytes, input.expected_version)
    const nextBytes = (existing?.bytes.byteLength ?? 0) + addition.byteLength
    if (nextBytes > MaxFileBytes) throw new Error(`File exceeds the ${MaxFileBytes}-byte maximum`)
    const content =
      existing === undefined ? addition : Buffer.concat([existing.bytes, addition], nextBytes)
    await replaceFile(root, relativePath, content, existing?.fileMode)
  })
  return relativeDisplayPath(relativePath)
}

async function loadRequiredFile(
  root: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<{ readonly file: StoredFile; readonly text: string; readonly version: string }> {
  const loaded = await loadFile(root, relativePath, signal)
  if (loaded === undefined) throw new Error(`File not found: ${relativeDisplayPath(relativePath)}`)
  return {
    file: loaded.file,
    text: decodeMarkdown(loaded.bytes, loaded.file.path),
    version: versionOf(loaded.bytes),
  }
}

function versionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function checkVersion(bytes: Uint8Array | undefined, expected: string | null | undefined): void {
  if (expected === undefined) return
  const actual = bytes === undefined ? null : versionOf(bytes)
  if (actual !== expected)
    throw new Error('File changed since it was read; reread and merge before writing')
}

async function loadForChange(root: string, path: string, signal: AbortSignal) {
  try {
    return await loadFile(root, path, signal)
  } catch (error) {
    // Missing parents are legitimate for a create. replaceFile validates them before installing.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export function normalizeFilePath(input: string): string {
  const relativePath = inspectRelativePath(input, false)
  if (extname(relativePath).toLowerCase() !== '.md') {
    throw new Error('File paths must end in .md')
  }
  return relativePath
}

function normalizePrefix(input: string | null | undefined): string {
  if (input === undefined || input === null || input === '') return ''
  return inspectRelativePath(input, true)
}

function inspectRelativePath(input: string, allowTrailingSlash: boolean): string {
  if (input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
    throw new Error('File paths must be relative POSIX paths')
  }
  const inspected = allowTrailingSlash && input.endsWith('/') ? input.slice(0, -1) : input
  const components = inspected.split('/')
  if (
    inspected === '' ||
    components.some((component) => component === '' || component === '.' || component === '..')
  ) {
    throw new Error('File paths cannot contain empty, . or .. components')
  }
  if (Buffer.byteLength(input, 'utf8') > 1_024)
    throw new Error('File path exceeds 1024 UTF-8 bytes')
  return input
}

function encodeBounded(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength > MaxFileBytes)
    throw new Error(`File exceeds the ${MaxFileBytes}-byte maximum`)
  return bytes
}

function decodeMarkdown(bytes: Uint8Array, path: string): string {
  try {
    return decoder.decode(bytes)
  } catch {
    throw new Error(`File is not valid UTF-8: ${path}`)
  }
}

function publicMetadata(file: StoredFile): FileMetadata {
  return {
    path: file.path,
    bytes: file.bytes,
    created_at: file.created_at,
    updated_at: file.updated_at,
  }
}

function lineIndex(value: number | null | undefined, lineCount: number, fallback: number): number {
  if (value === undefined || value === null) return fallback
  const index = value > 0 ? value - 1 : lineCount + value
  return Math.max(0, Math.min(index, Math.max(0, lineCount - 1)))
}
