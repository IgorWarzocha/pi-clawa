import { randomUUID } from 'node:crypto'
import { constants, type Dirent, type Stats } from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { MaxFileBytes } from './contracts.ts'

const MaxTraversedEntries = 10_000
const TemporaryPrefix = '.clawa-file-'

export interface StoredFile {
  readonly path: string
  readonly bytes: number
  readonly created_at: string
  readonly updated_at: string
  readonly absolutePath: string
  readonly relativePath: string
  readonly createdAt: number
  readonly updatedAt: number
}

type InspectedEntry =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'file'; readonly file: StoredFile }

export async function contentRoot(rootInput: string): Promise<string> {
  const root = resolve(rootInput)
  try {
    await mkdir(root)
  } catch (cause) {
    if (!hasCode(cause, 'EEXIST')) throw cause
  }
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Content root must be a real directory, not a link')
  }
  if ((await realpath(root)) !== root)
    throw new Error('Content root resolves outside its directory')
  return root
}

export async function discoverFiles(
  root: string,
  signal: AbortSignal,
): Promise<{ readonly files: StoredFile[]; readonly truncated: boolean }> {
  const files: StoredFile[] = []
  const pending = [root]
  let traversed = 0
  let truncated = false
  while (pending.length > 0) {
    throwIfAborted(signal)
    const directory = pending.pop()
    if (directory === undefined) break
    const scanned = await scanDirectory(directory, MaxTraversedEntries - traversed)
    const entries = scanned.entries
    traversed += entries.length
    truncated = scanned.truncated
    entries.sort((left, right) => right.name.localeCompare(left.name))
    const inspectedEntries = await inspectEntries(root, directory, entries, signal)
    collectEntries(inspectedEntries, pending, files, truncated, signal)
    if (truncated) pending.length = 0
  }
  return { files, truncated }
}

function collectEntries(
  entries: readonly (InspectedEntry | undefined)[],
  pending: string[],
  files: StoredFile[],
  truncated: boolean,
  signal: AbortSignal,
): void {
  for (const entry of entries) {
    throwIfAborted(signal)
    if (entry?.kind === 'directory' && !truncated) pending.push(entry.path)
    if (entry?.kind === 'file') files.push(entry.file)
  }
}

async function scanDirectory(directory: string, remaining: number) {
  const entries: Dirent[] = []
  const handle = await opendir(directory)
  for await (const entry of handle) {
    if (entry.name.startsWith(TemporaryPrefix)) continue
    if (entries.length >= remaining) return { entries, truncated: true }
    entries.push(entry)
  }
  return { entries, truncated: false }
}

async function inspectEntries(
  root: string,
  directory: string,
  entries: readonly Dirent[],
  signal: AbortSignal,
): Promise<ReadonlyArray<InspectedEntry | undefined>> {
  const results: Array<InspectedEntry | undefined> = new Array(entries.length)
  let cursor = 0
  const inspectNext = async (): Promise<void> => {
    const index = cursor
    cursor += 1
    const entry = entries[index]
    if (entry === undefined) return
    results[index] = await inspectEntry(root, directory, entry, signal)
    return inspectNext()
  }
  await Promise.all(Array.from({ length: Math.min(32, entries.length) }, () => inspectNext()))
  return results
}

async function inspectEntry(
  root: string,
  directory: string,
  entry: Dirent,
  signal: AbortSignal,
): Promise<InspectedEntry | undefined> {
  throwIfAborted(signal)
  if (entry.isSymbolicLink()) return undefined
  const path = join(directory, entry.name)
  let entryStat: Stats
  try {
    entryStat = await lstat(path)
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return undefined
    throw cause
  }
  if (entryStat.isSymbolicLink()) return undefined
  if (entryStat.isDirectory()) {
    return (await realPathIfExists(path)) === path ? { kind: 'directory', path } : undefined
  }
  if (!entryStat.isFile() || extname(entry.name).toLowerCase() !== '.md') return undefined
  if ((await realPathIfExists(path)) !== path) return undefined
  const relativePath = relative(root, path).split(sep).join('/')
  return { kind: 'file', file: metadata(path, relativePath, entryStat) }
}

async function realPathIfExists(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return undefined
    throw cause
  }
}

export async function loadFile(
  root: string,
  relativePath: string,
  signal: AbortSignal,
): Promise<
  | {
      readonly file: StoredFile
      readonly bytes: Buffer
      readonly fileMode: number
    }
  | undefined
> {
  throwIfAborted(signal)
  const path = join(root, relativePath)
  await assertSafeComponents(root, relativePath, true)
  let pathStat: Stats
  try {
    pathStat = await lstat(path)
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return undefined
    throw cause
  }
  if (!pathStat.isFile()) {
    throw new Error(`File path is not a regular file: ${relativeDisplayPath(relativePath)}`)
  }
  let handle: FileHandle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (cause) {
    if (hasCode(cause, 'ENOENT')) return undefined
    throw cause
  }
  try {
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`)
    if (!isWithin(root, openedPath) || openedPath !== path) {
      throw new Error('File paths cannot resolve outside content root')
    }
    const fileStat = await handle.stat()
    if (!fileStat.isFile())
      throw new Error(`File path is not a file: ${relativeDisplayPath(relativePath)}`)
    if (fileStat.size > MaxFileBytes) {
      throw new Error(
        `File exceeds the ${MaxFileBytes}-byte maximum: ${relativeDisplayPath(relativePath)}`,
      )
    }
    throwIfAborted(signal)
    const bytes = await handle.readFile()
    if (bytes.byteLength > MaxFileBytes) {
      throw new Error(
        `File exceeds the ${MaxFileBytes}-byte maximum: ${relativeDisplayPath(relativePath)}`,
      )
    }
    return {
      file: metadata(path, relativePath, fileStat),
      bytes,
      fileMode: fileStat.mode & 0o777,
    }
  } finally {
    await handle.close()
  }
}

export async function replaceFile(
  root: string,
  relativePath: string,
  content: Uint8Array,
  knownMode?: number,
): Promise<void> {
  if (content.byteLength > MaxFileBytes)
    throw new Error(`File exceeds the ${MaxFileBytes}-byte maximum`)
  const target = join(root, relativePath)
  await ensureSafeParent(root, dirname(relativePath))
  await assertSafeComponents(root, relativePath, true)
  let mode = knownMode ?? 0o644
  try {
    const targetStat = await lstat(target)
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new Error(`File path is not a regular file: ${relativeDisplayPath(relativePath)}`)
    }
    mode = targetStat.mode & 0o777
  } catch (cause) {
    if (!hasCode(cause, 'ENOENT')) throw cause
  }

  const temporary = join(dirname(target), `${TemporaryPrefix}${basename(target)}-${randomUUID()}`)
  let handle: FileHandle | undefined
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    )
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`)
    if (!isWithin(root, openedPath) || openedPath !== temporary) {
      throw new Error('File paths cannot resolve outside content root')
    }
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    await assertSafeComponents(root, dirname(relativePath), false)
    await rename(temporary, target)
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function ensureSafeParent(root: string, relativeDirectory: string): Promise<void> {
  if (relativeDirectory === '.') return
  let current = root
  for (const component of relativeDirectory.split('/')) {
    current = join(current, component)
    try {
      await mkdir(current)
    } catch (cause) {
      if (!hasCode(cause, 'EEXIST')) throw cause
    }
    const directoryStat = await lstat(current)
    if (
      directoryStat.isSymbolicLink() ||
      !directoryStat.isDirectory() ||
      (await realpath(current)) !== current
    ) {
      throw new Error('File paths cannot traverse links')
    }
  }
}

async function assertSafeComponents(
  root: string,
  relativePath: string,
  allowMissingLeaf: boolean,
): Promise<void> {
  let current = root
  const components = relativePath === '.' ? [] : relativePath.split('/')
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]
    if (component === undefined) continue
    current = join(current, component)
    if (
      !(await assertComponent(
        current,
        index < components.length - 1,
        allowMissingLeaf && index === components.length - 1,
      ))
    )
      return
  }
  const resolved = await realpath(current)
  if (!isWithin(root, resolved) || resolved !== resolve(current)) {
    throw new Error('File paths cannot resolve outside content root')
  }
}

async function assertComponent(
  path: string,
  parent: boolean,
  allowMissing: boolean,
): Promise<boolean> {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('File paths cannot traverse links')
    if (parent && !stat.isDirectory()) throw new Error('File path parent is not a directory')
    return true
  } catch (cause) {
    if (allowMissing && hasCode(cause, 'ENOENT')) return false
    throw cause
  }
}

function metadata(absolutePath: string, relativePath: string, fileStat: Stats): StoredFile {
  const createdAt = fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.ctimeMs
  return {
    absolutePath,
    relativePath,
    path: relativeDisplayPath(relativePath),
    bytes: fileStat.size,
    created_at: new Date(createdAt).toISOString(),
    updated_at: fileStat.mtime.toISOString(),
    createdAt,
    updatedAt: fileStat.mtimeMs,
  }
}

export function relativeDisplayPath(relativePath: string): string {
  return relativePath
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..')
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal)
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('File operation aborted', 'AbortError')
}

function hasCode(cause: unknown, code: string): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === code
}
