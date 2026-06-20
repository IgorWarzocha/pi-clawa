import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { loadClawasConfig } from '../clawas/config-loader.js'
import { findRepoRoot } from '../config.js'
import { parsePulseFrontmatter } from './frontmatter.js'
import { type PulseSchedule, parsePulseSchedule } from './schedule.js'

export interface PulseDefinition {
  key: string
  id: string
  title: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
  pulseHome: string
  relativeHome: string
  relativeFile: string
  absoluteFile: string
  scheduleText: string
  schedule: PulseSchedule
  enabled: boolean
  body: string
}

const PULSE_FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const PULSE_DEFINITION_FILE = 'PULSE.md'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readPulseFolder(options: {
  repoRoot: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
  pulseHome: string
}): Promise<PulseDefinition | null> {
  const id = relative(join(options.ownerHome, 'pulses'), options.pulseHome)
  if (!PULSE_FOLDER_PATTERN.test(id)) return null

  const file = join(options.pulseHome, PULSE_DEFINITION_FILE)
  const text = await readFile(file, 'utf8').catch(() => '')
  if (!text) return null

  const parsed = parsePulseFrontmatter(text)
  if (!(typeof parsed.data['title'] === 'string' && parsed.data['title'].trim())) return null

  const enabled = parsed.data['enabled'] !== false
  const scheduleText =
    typeof parsed.data['schedule'] === 'string' && parsed.data['schedule'].trim()
      ? parsed.data['schedule'].trim()
      : 'manual'
  const schedule = parsePulseSchedule(scheduleText)
  if (!(enabled && schedule)) return null

  const title = parsed.data['title'].trim()

  return {
    key: `${options.ownerId}:${id}`,
    id,
    title,
    ownerId: options.ownerId,
    ownerTitle: options.ownerTitle,
    ownerHome: options.ownerHome,
    pulseHome: options.pulseHome,
    relativeHome: relative(options.repoRoot, options.pulseHome),
    relativeFile: relative(options.repoRoot, file),
    absoluteFile: file,
    scheduleText,
    schedule,
    enabled,
    body: parsed.body,
  }
}

async function listPulseFolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && PULSE_FOLDER_PATTERN.test(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

async function readHomePulses(options: {
  repoRoot: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
}): Promise<PulseDefinition[]> {
  const dir = join(options.ownerHome, 'pulses')
  if (!(await pathExists(dir))) return []
  const folders = await listPulseFolders(dir)
  const definitions = await Promise.all(
    folders.map((pulseHome) => readPulseFolder({ ...options, pulseHome })),
  )
  return definitions.filter((definition): definition is PulseDefinition => Boolean(definition))
}

export async function discoverPulseDefinitions(cwd: string): Promise<PulseDefinition[]> {
  const repoRoot = findRepoRoot(cwd)
  const definitions: PulseDefinition[] = []
  definitions.push(
    ...(await readHomePulses({
      repoRoot,
      ownerId: 'main',
      ownerTitle: 'Main Clawa',
      ownerHome: repoRoot,
    })),
  )

  const config = await loadClawasConfig(repoRoot).catch(() => null)
  for (const worker of config?.workers ?? []) {
    definitions.push(
      ...(await readHomePulses({
        repoRoot,
        ownerId: worker.id,
        ownerTitle: worker.title,
        ownerHome: resolve(repoRoot, worker.cwd),
      })),
    )
  }

  return definitions
}

export function getPulseStatePath(cwd: string): string {
  return join(findRepoRoot(cwd), '.pi', 'pulses', 'state.json')
}
