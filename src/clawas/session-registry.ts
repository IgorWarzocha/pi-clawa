import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { type PanelHandle, parsePanelHandle } from './panel-host.js'
import type { WorkerDefinition, WorkerThinkingLevel } from './types.js'

export interface WorkerSessionRecord {
  path: string
  model?: string | undefined
  thinking?: WorkerThinkingLevel | undefined
  cwd?: string | undefined
  panel?: PanelHandle | undefined
}

interface SessionRegistry {
  workers: Record<string, WorkerSessionRecord>
}

const writes = new Map<string, Promise<unknown>>()
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(entry: Record<string, unknown>, key: string): string | undefined {
  const value = entry[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`Session registry ${key} must be a string`)
  return value
}

function normalizeWorkerRecord(entry: unknown, workerId: string): WorkerSessionRecord {
  if (typeof entry === 'string' && entry) return { path: entry }
  if (!isRecord(entry) || typeof entry['path'] !== 'string' || !entry['path']) {
    throw new Error(`Clawas session registry entry for ${workerId} is missing a path`)
  }
  const thinking = optionalString(entry, 'thinking')
  if (thinking !== undefined && !THINKING_LEVELS.some((level) => level === thinking)) {
    throw new Error(`Invalid thinking level in session registry for ${workerId}`)
  }
  return {
    path: entry['path'],
    model: optionalString(entry, 'model'),
    thinking: THINKING_LEVELS.find((level) => level === thinking),
    cwd: optionalString(entry, 'cwd'),
    panel: entry['panel'] === undefined ? undefined : parsePanelHandle(entry['panel']),
  }
}

async function readSession(sessionFile: string): Promise<{ cwd: string | undefined } | undefined> {
  try {
    const content = await fs.readFile(sessionFile, 'utf8')
    const firstLine = content.split('\n', 1)[0]
    if (!firstLine) return { cwd: undefined }
    const entry: unknown = JSON.parse(firstLine)
    return {
      cwd:
        isRecord(entry) && entry['type'] === 'session' && typeof entry['cwd'] === 'string'
          ? entry['cwd']
          : undefined,
    }
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}

export function getClawaSessionsDir(cwd: string): string {
  return path.join(cwd, '.pi', 'sessions')
}

async function readRegistry(rootDir: string): Promise<SessionRegistry> {
  try {
    const content = await fs.readFile(path.join(rootDir, 'session-registry.json'), 'utf8')
    const parsed: unknown = JSON.parse(content)
    if (!(isRecord(parsed) && isRecord(parsed['workers']))) {
      throw new Error('Clawas session registry must contain a workers object')
    }
    const workers: Record<string, WorkerSessionRecord> = {}
    for (const [id, record] of Object.entries(parsed['workers'])) {
      workers[id] = normalizeWorkerRecord(record, id)
    }
    return { workers }
  } catch (error) {
    if (isMissing(error)) return { workers: {} }
    throw error
  }
}

async function updateRegistry<T>(
  rootDir: string,
  update: (registry: SessionRegistry) => Promise<T> | T,
): Promise<T> {
  // Every worker shares this file. Serialize read-modify-write, including failed predecessors.
  const operation = (writes.get(rootDir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const registry = await readRegistry(rootDir)
      const result = await update(registry)
      await fs.mkdir(rootDir, { recursive: true })
      const target = path.join(rootDir, 'session-registry.json')
      const temporary = `${target}.${process.pid}.tmp`
      try {
        await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
        await fs.rename(temporary, target)
      } finally {
        await fs.rm(temporary, { force: true })
      }
      return result
    })
  writes.set(rootDir, operation)
  try {
    return await operation
  } finally {
    if (writes.get(rootDir) === operation) writes.delete(rootDir)
  }
}

export async function readWorkerSession(
  rootDir: string,
  workerId: string,
): Promise<WorkerSessionRecord | undefined> {
  await writes.get(rootDir)
  return (await readRegistry(rootDir)).workers[workerId]
}

export async function recordWorkerSession(
  rootDir: string,
  definition: WorkerDefinition,
  cwd: string,
  sessionFile: string,
  panel: PanelHandle | undefined,
): Promise<void> {
  await updateRegistry(rootDir, (registry) => {
    registry.workers[definition.id] = {
      path: sessionFile,
      cwd,
      model: definition.model,
      thinking: definition.thinking,
      panel,
    }
  })
}

export async function resolveWorkerSessionFile(
  rootDir: string,
  definition: WorkerDefinition,
  cwd: string,
): Promise<{ sessionFile: string; kind: 'fresh' | 'resume' }> {
  return await updateRegistry(rootDir, async (registry) => {
    const known = registry.workers[definition.id]
    if (known && (!known.cwd || known.cwd === cwd)) {
      const session = await readSession(known.path)
      // SessionManager may not have flushed a new empty session yet. Keep its reserved
      // path rather than allocating a second session during a concurrent panel start.
      if (!session?.cwd || session.cwd === cwd) {
        registry.workers[definition.id] = {
          ...known,
          model: definition.model,
          thinking: definition.thinking,
          cwd,
        }
        return { sessionFile: known.path, kind: session ? 'resume' : 'fresh' }
      }
    }

    const sessionsDir = getClawaSessionsDir(cwd)
    await fs.mkdir(sessionsDir, { recursive: true })
    const sessionFile = SessionManager.create(cwd, sessionsDir).getSessionFile()
    if (!sessionFile) throw new Error(`Failed to create Clawas session for ${definition.id}`)
    registry.workers[definition.id] = {
      path: sessionFile,
      cwd,
      model: definition.model,
      thinking: definition.thinking,
    }
    return { sessionFile, kind: 'fresh' }
  })
}
