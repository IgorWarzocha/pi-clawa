import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const CLAW_STATE_VERSION = 1
const CLAW_STATE_FILENAME = join('.pi', 'claw.json')
const BOOTSTRAPPED_SENTINEL_FILES = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
  'CURIOUS.md',
  'TOOLS.md',
] as const

export interface ClawState {
  version: number
  bootstrapped: boolean
  bootstrappedAt?: string
}

export function resolveClawStatePath(cwd: string): string {
  return join(cwd, CLAW_STATE_FILENAME)
}

export async function readClawState(cwd: string): Promise<ClawState> {
  const statePath = resolveClawStatePath(cwd)
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw) as {
      version?: unknown
      bootstrapped?: unknown
      bootstrappedAt?: unknown
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : CLAW_STATE_VERSION,
      bootstrapped: parsed.bootstrapped === true,
      bootstrappedAt: typeof parsed.bootstrappedAt === 'string' ? parsed.bootstrappedAt : undefined,
    }
  } catch {
    return { version: CLAW_STATE_VERSION, bootstrapped: false }
  }
}

async function hasBootstrappedFiles(cwd: string): Promise<boolean> {
  for (const file of BOOTSTRAPPED_SENTINEL_FILES) {
    try {
      await access(join(cwd, file))
    } catch {
      return false
    }
  }
  return true
}

export async function isClawBootstrapped(cwd: string): Promise<boolean> {
  const state = await readClawState(cwd)
  if (state.bootstrapped === true) return true
  return hasBootstrappedFiles(cwd)
}

export async function markClawBootstrapped(cwd: string): Promise<string> {
  const statePath = resolveClawStatePath(cwd)
  const current = await readClawState(cwd)
  const next: ClawState = {
    version: CLAW_STATE_VERSION,
    bootstrapped: true,
    bootstrappedAt: current.bootstrappedAt ?? new Date().toISOString(),
  }
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(next, null, '\t')}\n`, 'utf8')
  return statePath
}
