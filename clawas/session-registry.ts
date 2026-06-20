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

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  )
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
    const identity: { model?: string; thinking?: ThinkingLevel } = {}

    for (const line of lines) {
      Object.assign(identity, readSessionIdentityLine(line))
    }

    return identity
  } catch {
    return {}
  }
}

function readSessionIdentityLine(line: string): { model?: string; thinking?: ThinkingLevel } {
  const entry = parseSessionEntry(line)
  if (!entry) return {}
  if (entry['type'] === 'model_change') return modelChangeIdentity(entry)
  if (entry['type'] === 'thinking_level_change') return thinkingChangeIdentity(entry)
  if (entry['type'] === 'message') return assistantMessageIdentity(entry)
  return {}
}

function parseSessionEntry(line: string): Record<string, unknown> | null {
  try {
    const entry = JSON.parse(line)
    return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function modelChangeIdentity(entry: Record<string, unknown>): { model?: string } {
  if (typeof entry['provider'] === 'string' && typeof entry['modelId'] === 'string') {
    return { model: `${entry['provider']}/${entry['modelId']}` }
  }
  return {}
}

function thinkingChangeIdentity(entry: Record<string, unknown>): { thinking?: ThinkingLevel } {
  const value = entry['thinkingLevel']
  return isThinkingLevel(value) ? { thinking: value } : {}
}

function assistantMessageIdentity(entry: Record<string, unknown>): { model?: string } {
  const message = entry['message']
  if (!message || typeof message !== 'object') return {}
  const record = message as Record<string, unknown>
  if (
    record['role'] === 'assistant' &&
    typeof record['provider'] === 'string' &&
    typeof record['model'] === 'string'
  ) {
    return { model: `${record['provider']}/${record['model']}` }
  }
  return {}
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

export function getClawaSessionRoot(cwd: string): string {
  return path.join(cwd, '.pi')
}

export function getClawaSessionsDir(cwd: string): string {
  return path.join(getClawaSessionRoot(cwd), 'sessions')
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
