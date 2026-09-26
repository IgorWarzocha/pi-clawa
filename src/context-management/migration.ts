import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MaxFileBytes } from './files/contracts.ts'
import { withWriteLock } from './files/write-lock.ts'

export interface MigrationNotice {
  readonly vaultFiles: number
  readonly legacyRows: number
  readonly legacyDatabase: 'absent' | 'retained'
}

function abort(signal: AbortSignal): void {
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Migration aborted', 'AbortError')
}

async function directory(path: string, create: boolean): Promise<boolean> {
  if (create)
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return false
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(path)) !== resolve(path)) {
    throw new Error(`Migration requires a real directory: ${path}`)
  }
  return true
}

async function file(path: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return false
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Migration requires a regular file: ${path}`)
  return true
}

async function walk(
  root: string,
  signal: AbortSignal,
): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = []
  const folders: string[] = []
  const visit = async (folder: string): Promise<void> => {
    abort(signal)
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        folders.push(relative(root, path))
        await visit(path)
      } else if (entry.isFile()) files.push(relative(root, path))
      else throw new Error(`Cannot migrate vault entry that is not a regular file: ${path}`)
    }
  }
  await visit(root)
  return { files: files.sort(), folders: folders.sort() }
}

async function equal(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([safeRead(left), safeRead(right)])
  return a.equals(b)
}

async function safeRead(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(`Migration requires a regular file: ${path}`)
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function install(path: string, bytes: Uint8Array): Promise<void> {
  const temp = `${path}.clawa-migrate-${randomUUID()}`
  try {
    const handle = await open(
      temp,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o644,
    )
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    // link, unlike rename, refuses a late destination collision.
    await link(temp, path)
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

async function installIdentical(path: string, bytes: Buffer): Promise<boolean> {
  if (await file(path)) {
    if (!(await safeRead(path)).equals(bytes))
      throw new Error(`Migration collision at ${path}; source is unchanged`)
    return false
  }
  try {
    await install(path, bytes)
    return true
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
      !(await file(path)) ||
      !(await safeRead(path)).equals(bytes)
    )
      throw error
    return false
  }
}

async function ensureParents(root: string, name: string, create: boolean): Promise<void> {
  let parent = root
  for (const part of name.split(sep).slice(0, -1)) {
    parent = join(parent, part)
    if (
      create ||
      (await lstat(parent).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }))
    )
      await directory(parent, create)
  }
}

async function preflightVault(
  old: string,
  target: string,
  files: string[],
  folders: string[],
  signal: AbortSignal,
): Promise<void> {
  for (const name of folders) {
    abort(signal)
    const dest = join(target, name)
    if (
      await lstat(dest).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
    )
      await directory(dest, false)
  }
  for (const name of files) {
    abort(signal)
    await ensureParents(target, name, false)
    const dest = join(target, name)
    if ((await file(dest)) && !(await equal(join(old, name), dest))) {
      throw new Error(`Migration collision at ${dest}; source vault is unchanged`)
    }
  }
}

async function removeEmpty(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmpty(join(path, entry.name))
  }
  await rmdir(path)
}

async function migrateVault(root: string, signal: AbortSignal): Promise<number> {
  const old = join(root, 'vault')
  if (!(await directory(old, false))) return 0
  const target = join(root, 'memory')
  const { files, folders } = await walk(old, signal)
  await directory(target, true)
  // Preflight all collisions before changing any source. Parent obstructions and links fail visibly.
  await preflightVault(old, target, files, folders, signal)
  for (const name of folders) {
    let parent = target
    for (const part of name.split(sep)) {
      parent = join(parent, part)
      await directory(parent, true)
    }
  }
  for (const name of files) {
    abort(signal)
    const dest = join(target, name)
    await ensureParents(target, name, true)
    await installIdentical(dest, await safeRead(join(old, name)))
  }
  for (const name of files) {
    abort(signal)
    if (!(await equal(join(old, name), join(target, name))))
      throw new Error(`Migration verification failed for ${name}`)
  }
  // A retry after an interruption sees identical targets and can finish cleanup.
  for (const name of files) await unlink(join(old, name))
  await removeEmpty(old)
  return files.length
}

interface LegacyRow {
  id: number
  ts: number
  text: string
  tags: string
}

async function importLegacyRow(
  legacy: string,
  raw: Record<string, null | number | bigint | string | Uint8Array>,
): Promise<{ id: number; imported: boolean }> {
  const { id, ts, text, tags } = raw
  if (
    typeof id !== 'number' ||
    typeof ts !== 'number' ||
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(ts) ||
    typeof text !== 'string' ||
    typeof tags !== 'string'
  ) {
    throw new Error(
      'Legacy memory row contains unsupported values; import stopped without truncation',
    )
  }
  const row: LegacyRow = { id, ts, text, tags }
  const payload = JSON.stringify({ id: row.id, ts: row.ts, text: row.text, tags: row.tags })
  const bytes = Buffer.from(`${payload}\n`)
  if (bytes.byteLength > MaxFileBytes) {
    throw new Error(
      `Legacy memory #${row.id} exceeds the ${MaxFileBytes}-byte file limit; import stopped without truncation`,
    )
  }
  const digest = createHash('sha256').update(payload).digest('hex')
  // JSON in a Markdown file has no delimiters that legacy text could escape.
  const imported = await installIdentical(join(legacy, `${row.id}-${digest}.md`), bytes)
  return { id: row.id, imported }
}

async function migrateLegacy(
  root: string,
  signal: AbortSignal,
): Promise<{ rows: number; database: 'absent' | 'retained' }> {
  const path = join(root, '.pi', 'clawa-memory.sqlite')
  if (!(await file(path))) return { rows: 0, database: 'absent' }
  const db = new DatabaseSync(path, { readOnly: true })
  let rows = 0
  try {
    const legacy = join(root, 'memory', 'legacy')
    await directory(join(root, 'memory'), true)
    await directory(legacy, true)
    const query = db.prepare(
      'SELECT id, ts, text, tags FROM memories WHERE id > ? ORDER BY id LIMIT 16',
    )
    let cursor = 0
    while (true) {
      abort(signal)
      const batch = query.all(cursor)
      if (batch.length === 0) break
      for (const row of batch) {
        const result = await importLegacyRow(legacy, row)
        cursor = result.id
        if (result.imported) rows += 1
      }
    }
    return { rows, database: 'retained' }
  } finally {
    db.close()
  }
}

/** Run before starter-page copying and on existing-home startup; all Clawas share this lock. */
export async function migrateMemory(
  rootHouse: string,
  signal: AbortSignal,
): Promise<MigrationNotice> {
  const root = resolve(rootHouse)
  if (!(await directory(root, false))) throw new Error(`Clawa home does not exist: ${root}`)
  await directory(join(root, '.pi'), true)
  await directory(join(root, '.pi', 'context'), true)
  return withWriteLock(join(root, '.pi', 'context', 'migration-lock'), signal, async () => {
    const vaultFiles = await migrateVault(root, signal)
    const legacy = await migrateLegacy(root, signal)
    return { vaultFiles, legacyRows: legacy.rows, legacyDatabase: legacy.database }
  })
}
