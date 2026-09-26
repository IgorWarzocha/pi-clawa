import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ExtensionContext, SessionHeader } from '@earendil-works/pi-coding-agent'

export interface ContextAccess {
  rootHouse: string
  agentName: string
  sessionDirs?: readonly string[]
  homes?: readonly { cwd: string; agentName: string; sessionDir?: string }[]
}

export interface ChatRecord {
  sessionId: string
  sessionFile: string
  cwd: string
  agentName: string
}

const idPattern = /^[a-zA-Z0-9_-]{1,128}$/u
const maxDiscoveryFiles = 1000
const maxSessionBytes = 32 * 1024 * 1024

function catalogDir(access: ContextAccess): string {
  return join(access.rootHouse, '.pi', 'context', 'chats')
}

function validId(id: string): boolean {
  return idPattern.test(id)
}

function homes(access: ContextAccess, ctx: ExtensionContext) {
  return [
    { cwd: access.rootHouse, agentName: 'main' },
    { cwd: ctx.cwd, agentName: access.agentName },
    ...(access.homes ?? []),
  ]
}

async function authorized(
  access: ContextAccess,
  ctx: ExtensionContext,
  record: ChatRecord,
  allowUnflushed = false,
): Promise<boolean> {
  if (
    !(
      validId(record.sessionId) &&
      validId(record.agentName) &&
      isAbsolute(record.sessionFile) &&
      isAbsolute(record.cwd)
    )
  )
    return false
  const known = homes(access, ctx).find(
    (home) => resolve(home.cwd) === resolve(record.cwd) && home.agentName === record.agentName,
  )
  if (!known) return false
  if (
    allowUnflushed &&
    record.sessionId === ctx.sessionManager.getSessionId() &&
    resolve(record.sessionFile) === resolve(ctx.sessionManager.getSessionFile() ?? '')
  ) {
    return true
  }
  const file = await realpath(record.sessionFile)
  if (file !== resolve(record.sessionFile) || !file.endsWith('.jsonl')) return false
  const header = await readHeader(file)
  return header?.id === record.sessionId && resolve(header.cwd) === resolve(record.cwd)
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decode(value: unknown): ChatRecord {
  if (
    !isRecord(value) ||
    typeof value['sessionId'] !== 'string' ||
    typeof value['sessionFile'] !== 'string' ||
    typeof value['cwd'] !== 'string' ||
    typeof value['agentName'] !== 'string'
  ) {
    throw new Error('Invalid chat catalog record')
  }
  return {
    sessionId: value['sessionId'],
    sessionFile: value['sessionFile'],
    cwd: value['cwd'],
    agentName: value['agentName'],
  }
}

async function readHeader(file: string): Promise<SessionHeader | undefined> {
  const handle = await open(file, 'r')
  try {
    if ((await handle.stat()).size > maxSessionBytes)
      throw new Error(`Session too large to index: ${file}`)
    const bytes = Buffer.alloc(16_384)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const line = bytes.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0]
    if (!line || line.length >= bytes.length) return undefined
    const value: unknown = JSON.parse(line)
    if (
      !isRecord(value) ||
      value['type'] !== 'session' ||
      typeof value['id'] !== 'string' ||
      typeof value['cwd'] !== 'string'
    )
      return undefined
    return {
      type: 'session',
      id: value['id'],
      cwd: value['cwd'],
      timestamp: typeof value['timestamp'] === 'string' ? value['timestamp'] : '',
    }
  } finally {
    await handle.close()
  }
}

function configuredDirs(access: ContextAccess, ctx: ExtensionContext): string[] {
  return [
    ...new Set(
      [
        ctx.sessionManager.getSessionDir(),
        ...(access.sessionDirs ?? []),
        ...(access.homes ?? [])
          .map((home) => home.sessionDir)
          .filter((dir): dir is string => Boolean(dir)),
      ]
        .filter(Boolean)
        .map((dir) => resolve(dir)),
    ),
  ]
}

async function save(access: ContextAccess, record: ChatRecord): Promise<void> {
  const dir = catalogDir(access)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${record.sessionId}.json`)
  try {
    const existing = decode(JSON.parse(await readFile(target, 'utf8')))
    if (JSON.stringify(existing) === JSON.stringify(record)) return
    throw new Error(`Chat catalog ID collision: ${record.sessionId}`)
  } catch (error) {
    if (!missing(error)) throw error
  }
  const temporary = join(dir, `.${record.sessionId}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary)
    throw error
  }
}

export async function indexCurrentChat(
  access: ContextAccess,
  ctx: ExtensionContext,
): Promise<void> {
  const file = ctx.sessionManager.getSessionFile()
  const id = ctx.sessionManager.getSessionId()
  if (!(file && validId(id) && validId(access.agentName))) return
  const record = {
    sessionId: id,
    sessionFile: resolve(file),
    cwd: resolve(ctx.cwd),
    agentName: access.agentName,
  }
  if (!(await authorized(access, ctx, record, true)))
    throw new Error('Session is outside known house homes')
  await save(access, record)
}

export async function listCatalog(
  access: ContextAccess,
  ctx: ExtensionContext,
): Promise<ChatRecord[]> {
  await indexCurrentChat(access, ctx)
  // Only explicitly provided directories are searched, never Pi's global session tree.
  for (const dir of configuredDirs(access, ctx)) await discoverDir(access, ctx, dir)
  return loadCatalog(access, ctx)
}

async function loadCatalog(access: ContextAccess, ctx: ExtensionContext): Promise<ChatRecord[]> {
  let files: string[]
  try {
    files = await readdir(catalogDir(access))
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
  const records: ChatRecord[] = []
  for (const name of files) {
    const record = await loadRecord(access, ctx, name)
    if (record) records.push(record)
  }
  return records
}

async function loadRecord(
  access: ContextAccess,
  ctx: ExtensionContext,
  name: string,
): Promise<ChatRecord | undefined> {
  if (!(name.endsWith('.json') && validId(name.slice(0, -5)))) return undefined
  const record = decode(JSON.parse(await readFile(join(catalogDir(access), name), 'utf8')))
  if (record.sessionId !== name.slice(0, -5)) throw new Error(`Chat catalog ID mismatch: ${name}`)
  try {
    if (await authorized(access, ctx, record, true)) return record
  } catch (error) {
    if (!missing(error)) throw error
  }
  return undefined
}

async function discoverDir(
  access: ContextAccess,
  ctx: ExtensionContext,
  dir: string,
): Promise<void> {
  let files: Dirent[]
  try {
    files = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (missing(error)) return
    throw error
  }
  if (files.length > maxDiscoveryFiles)
    throw new Error(`Session discovery exceeds ${maxDiscoveryFiles} files in ${dir}`)
  for (const entry of files) {
    if (!(entry.isFile() && entry.name.endsWith('.jsonl'))) continue
    const file = join(dir, entry.name)
    const header = await readHeader(file)
    if (!(header && validId(header.id) && isAbsolute(header.cwd))) continue
    const agentName = homes(access, ctx).find(
      (home) => resolve(home.cwd) === resolve(header.cwd),
    )?.agentName
    if (!agentName) continue
    const record = { sessionId: header.id, sessionFile: file, cwd: header.cwd, agentName }
    if (await authorized(access, ctx, record)) await save(access, record)
  }
}

export async function findChat(
  access: ContextAccess,
  ctx: ExtensionContext,
  id?: string,
): Promise<ChatRecord> {
  const target = id ?? ctx.sessionManager.getSessionId()
  if (!validId(target)) throw new Error('Invalid chat_id')
  if (target === ctx.sessionManager.getSessionId()) {
    await indexCurrentChat(access, ctx)
    const file = ctx.sessionManager.getSessionFile()
    if (!file) throw new Error('Current Pi chat has no session file')
    return {
      sessionId: target,
      sessionFile: resolve(file),
      cwd: resolve(ctx.cwd),
      agentName: access.agentName,
    }
  }
  let record: ChatRecord | undefined
  try {
    record = await loadRecord(access, ctx, `${target}.json`)
  } catch (error) {
    if (!missing(error)) throw error
  }
  record ??= (await listCatalog(access, ctx)).find((chat) => chat.sessionId === target)
  if (!record) throw new Error(`Unknown chat_id in this house: ${target}`)
  return record
}
