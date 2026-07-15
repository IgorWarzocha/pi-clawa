import { readFileSync } from 'node:fs'
import { link, readFile, rm, writeFile } from 'node:fs/promises'

const LEGACY_PID_PATTERN = /^\d+$/u

export interface GatewayLockRecord {
  pid: number
  projectRoot: string
  entryPath: string
  startedAt: string
}

export async function acquireGatewayLock(
  lockPath: string,
  record: GatewayLockRecord,
): Promise<() => Promise<void>> {
  const temporaryPath = `${lockPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    for (;;) {
      try {
        await link(temporaryPath, lockPath)
        break
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error
        const existing = await readGatewayLock(lockPath)
        if (existing && isGatewayProcessAlive(existing)) {
          throw new Error(`pi-clawa-discord gateway is already running as pid ${existing.pid}`)
        }
        await rm(lockPath, { force: true })
      }
    }
  } finally {
    await rm(temporaryPath, { force: true })
  }

  return async () => {
    const current = await readGatewayLock(lockPath)
    if (current?.pid === record.pid && current.startedAt === record.startedAt) {
      await rm(lockPath, { force: true })
    }
  }
}

export async function readGatewayLock(lockPath: string): Promise<GatewayLockRecord | null> {
  try {
    const raw = (await readFile(lockPath, 'utf8')).trim()
    if (LEGACY_PID_PATTERN.test(raw)) {
      return {
        pid: Number(raw),
        projectRoot: '',
        entryPath: '',
        startedAt: 'legacy',
      }
    }
    const parsed = JSON.parse(raw) as Partial<GatewayLockRecord>
    if (!Number.isSafeInteger(parsed.pid) || (parsed.pid ?? 0) <= 0) return null
    if (typeof parsed.projectRoot !== 'string') return null
    if (typeof parsed.entryPath !== 'string') return null
    if (typeof parsed.startedAt !== 'string') return null
    return parsed as GatewayLockRecord
  } catch (error) {
    if (isMissingFileError(error)) return null
    return null
  }
}

export function isGatewayProcessAlive(record: GatewayLockRecord): boolean {
  try {
    process.kill(record.pid, 0)
  } catch {
    return false
  }

  const expected = record.entryPath || 'gateway/cli/index.ts'
  try {
    const commandLine = requireProcessCommandLine(record.pid)
    return commandLine.includes(expected) || commandLine.includes('pi-clawa-discord')
  } catch {
    return record.startedAt !== 'legacy'
  }
}

function requireProcessCommandLine(pid: number): string {
  return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/gu, ' ')
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
