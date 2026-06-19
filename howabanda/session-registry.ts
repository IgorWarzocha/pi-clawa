import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { WorkerDefinition } from './types.js'

interface WorkerSessionRecord {
  path: string
  model?: string
  thinking?: ThinkingLevel
  cwd?: string
}

interface SessionRegistry {
  workers: Record<string, WorkerSessionRecord | string>
}

function normalizeWorkerRecord(
  entry: WorkerSessionRecord | string | undefined,
): WorkerSessionRecord | null {
  if (!entry) {
    return null
  }

  if (typeof entry === 'string') {
    return { path: entry }
  }

  if (typeof entry.path !== 'string' || !entry.path) {
    return null
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

async function readSessionIdentity(sessionFile: string): Promise<{
  model?: string
  thinking?: ThinkingLevel
}> {
  try {
    const content = await fs.readFile(sessionFile, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    let model: string | undefined
    let thinking: ThinkingLevel | undefined

    for (const line of lines) {
      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      if (!entry || typeof entry !== 'object') {
        continue
      }

      if (
        'type' in entry &&
        entry.type === 'model_change' &&
        'provider' in entry &&
        typeof entry.provider === 'string' &&
        'modelId' in entry &&
        typeof entry.modelId === 'string'
      ) {
        model = `${entry.provider}/${entry.modelId}`
        continue
      }

      if (
        'type' in entry &&
        entry.type === 'thinking_level_change' &&
        'thinkingLevel' in entry &&
        typeof entry.thinkingLevel === 'string'
      ) {
        thinking = entry.thinkingLevel
        continue
      }

      const message = 'message' in entry ? entry.message : undefined
      if (
        'type' in entry &&
        entry.type === 'message' &&
        message &&
        typeof message === 'object' &&
        message?.role === 'assistant' &&
        typeof message.provider === 'string' &&
        typeof message.model === 'string'
      ) {
        model = `${message.provider}/${message.model}`
      }
    }

    return { model, thinking }
  } catch {
    return {}
  }
}

async function sessionMatchesDefinition(
  record: WorkerSessionRecord,
  definition: WorkerDefinition,
  cwd: string,
): Promise<boolean> {
  if (record.cwd && record.cwd !== cwd) {
    return false
  }

  if (record.model === definition.model && record.thinking === definition.thinking) {
    return true
  }

  const identity = await readSessionIdentity(record.path)
  return identity.model === definition.model && identity.thinking === definition.thinking
}

function getRegistryPath(rootDir: string): string {
  return path.join(rootDir, 'session-registry.json')
}

async function readRegistry(rootDir: string): Promise<SessionRegistry> {
  try {
    const content = await fs.readFile(getRegistryPath(rootDir), 'utf8')
    const parsed = JSON.parse(content) as SessionRegistry
    return { workers: parsed.workers ?? {} }
  } catch {
    return { workers: {} }
  }
}

export async function getRegisteredWorkerSessionFile(
  rootDir: string,
  workerId: string,
): Promise<string | undefined> {
  const registry = await readRegistry(rootDir)
  const record = normalizeWorkerRecord(registry.workers[workerId])
  if (!record) {
    return undefined
  }

  try {
    await fs.access(record.path)
    return record.path
  } catch {
    return undefined
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
  const knownRecord = normalizeWorkerRecord(registry.workers[workerId])
  if (knownRecord) {
    try {
      await fs.access(knownRecord.path)
      if (await sessionMatchesDefinition(knownRecord, definition, cwd)) {
        registry.workers[workerId] = buildWorkerRecord(definition, knownRecord.path, cwd)
        await writeRegistry(rootDir, registry)
        return knownRecord.path
      }
    } catch {
      // Fall through and recreate the session file.
    }
  }

  const sessionsDir = path.join(rootDir, 'sessions')
  await fs.mkdir(sessionsDir, { recursive: true })
  const sessionManager = SessionManager.create(cwd, sessionsDir)
  const sessionFile = sessionManager.getSessionFile()
  if (!sessionFile) {
    throw new Error(`Failed to create HOWABANDA session for ${workerId}`)
  }

  registry.workers[workerId] = buildWorkerRecord(definition, sessionFile, cwd)
  await writeRegistry(rootDir, registry)
  return sessionFile
}
