import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getPulseStatePath } from './definitions.js'

interface PulseEntryState {
  firstSeenAt?: number | undefined
  lastRunAt?: number | undefined
  lastDueKey?: string | undefined
}

export interface PulseSchedulerState {
  pulses: Record<string, PulseEntryState>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeState(value: unknown): PulseSchedulerState {
  if (!(isRecord(value) && isRecord(value['pulses']))) return { pulses: {} }
  const pulses: Record<string, PulseEntryState> = {}
  for (const [key, raw] of Object.entries(value['pulses'])) {
    if (!isRecord(raw)) continue
    pulses[key] = {
      firstSeenAt: asNumber(raw['firstSeenAt']),
      lastRunAt: asNumber(raw['lastRunAt']),
      lastDueKey: asString(raw['lastDueKey']),
    }
  }
  return { pulses }
}

export async function readPulseState(cwd: string): Promise<PulseSchedulerState> {
  try {
    return normalizeState(JSON.parse(await readFile(getPulseStatePath(cwd), 'utf8')))
  } catch {
    return { pulses: {} }
  }
}

export async function writePulseState(cwd: string, state: PulseSchedulerState): Promise<void> {
  const path = getPulseStatePath(cwd)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}
