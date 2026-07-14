import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { WorkerDefinition } from './types.js'

interface WorkerSessionRecord {
  path: string
  model?: string | undefined
  thinking?: ThinkingLevel | undefined
  cwd?: string | undefined
}

interface SessionRegistry {
  workers: Record<string, WorkerSessionRecord | string>
}

function normalizeWorkerRecord(
  entry: WorkerSessionRecord | string | undefined,
  workerId: string,
): WorkerSessionRecord | null {
  if (!entry) {
    return null
  }

  if (typeof entry === 'string') {
    if (!entry) throw new Error(`Clawas session registry entry for ${workerId} is empty`)
    return { path: entry }
  }

  if (typeof entry.path !== 'string' || !entry.path) {
    throw new Error(`Clawas session registry entry for ${workerId} is missing a path`)
  }

  return entry
}

function buildWorkerRecord(
  definition: WorkerDefinition,
  pathValue: string,
  cwd: string,
): WorkerSessionRecord {
  return {
    path: pathValue,
    model: definition.model,
    thinking: definition.thinking,
    cwd,
  }
}

async function readSessionCwd(sessionFile: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(sessionFile, 'utf8')
    const firstLine = content.split('\n', 1)[0]
    if (!firstLine) return undefined
    const entry = parseSessionEntry(firstLine)
    return entry?.['type'] === 'session' && typeof entry['cwd'] === 'string'
      ? entry['cwd']
      : undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return undefined
    throw error
  }
}

function parseSessionEntry(line: string): Record<string, unknown> | null {
  try {
    const entry = JSON.parse(line)
    return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function sessionBelongsToWorker(record: WorkerSessionRecord, cwd: string): Promise<boolean> {
  if (record.cwd && record.cwd !== cwd) {
    return false
  }
  const sessionCwd = await readSessionCwd(record.path)
  return !sessionCwd || sessionCwd === cwd
}

function getRegistryPath(rootDir: string): string {
  return path.join(rootDir, 'session-registry.json')
}

export function getClawaSessionRoot(cwd: string): string {
  return path.join(cwd, '.pi')
}

export function getClawaSessionsDir(cwd: string): string {
  return path.join(getClawaSessionRoot(cwd), 'sessions')
}

async function readRegistry(rootDir: string): Promise<SessionRegistry> {
  try {
    const content = await fs.readFile(getRegistryPath(rootDir), 'utf8')
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Clawas session registry must be a JSON object')
    }
    const workers = (parsed as Record<string, unknown>)['workers']
    if (!workers || typeof workers !== 'object' || Array.isArray(workers)) {
      throw new Error('Clawas session registry must contain a workers object')
    }
    return { workers: workers as SessionRegistry['workers'] }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { workers: {} }
    throw error
  }
}

async function writeRegistry(rootDir: string, registry: SessionRegistry): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true })
  await fs.writeFile(getRegistryPath(rootDir), `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
}

export async function resolveWorkerSessionFile(
  rootDir: string,
  definition: WorkerDefinition,
  cwd: string,
): Promise<string> {
  const registry = await readRegistry(rootDir)
  const workerId = definition.id
  const knownRecord = normalizeWorkerRecord(registry.workers[workerId], workerId)
  if (knownRecord) {
    try {
      await fs.access(knownRecord.path)
      // Model and thinking are runtime choices, not worker identity. Pi can
      // change both while resuming the same session; rotating the file here
      // silently amputates the worker's continuity.
      if (await sessionBelongsToWorker(knownRecord, cwd)) {
        registry.workers[workerId] = buildWorkerRecord(definition, knownRecord.path, cwd)
        await writeRegistry(rootDir, registry)
        return knownRecord.path
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      // Missing session file: create a replacement and update the registry.
    }
  }

  const sessionsDir = getClawaSessionsDir(cwd)
  await fs.mkdir(sessionsDir, { recursive: true })
  const sessionManager = SessionManager.create(cwd, sessionsDir)
  const sessionFile = sessionManager.getSessionFile()
  if (!sessionFile) {
    throw new Error(`Failed to create Clawas session for ${workerId}`)
  }

  registry.workers[workerId] = buildWorkerRecord(definition, sessionFile, cwd)
  await writeRegistry(rootDir, registry)
  return sessionFile
}
