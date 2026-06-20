import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { loadClawasConfig } from '../clawas/config-loader.js'
import { findRepoRoot } from '../config.js'
import { parsePulseFrontmatter } from './frontmatter.js'
import { type PulseSchedule, parsePulseSchedule } from './schedule.js'

export interface PulseDefinition {
  status: 'valid'
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

interface InvalidPulseDefinition {
  status: 'invalid'
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
  error: string
}

export type PulseCatalogItem = PulseDefinition | InvalidPulseDefinition

const PULSE_FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]*$/u
const PULSE_DEFINITION_FILE = 'PULSE.md'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return false
    throw error
  }
}

async function readPulseFolder(options: {
  repoRoot: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
  pulseHome: string
}): Promise<PulseCatalogItem> {
  const id = relative(join(options.ownerHome, 'pulses'), options.pulseHome)
  const file = join(options.pulseHome, PULSE_DEFINITION_FILE)
  const invalid = (error: string): InvalidPulseDefinition => ({
    status: 'invalid',
    key: `${options.ownerId}:${id}`,
    id,
    title: `Invalid pulse: ${id}`,
    ownerId: options.ownerId,
    ownerTitle: options.ownerTitle,
    ownerHome: options.ownerHome,
    pulseHome: options.pulseHome,
    relativeHome: relative(options.repoRoot, options.pulseHome),
    relativeFile: relative(options.repoRoot, file),
    absoluteFile: file,
    error,
  })

  if (!PULSE_FOLDER_PATTERN.test(id)) return invalid('pulse folder name must be kebab-case')

  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return invalid('missing PULSE.md')
    throw error
  }
  if (!text.trim()) return invalid('PULSE.md is empty')

  const parsed = parsePulseFrontmatter(text)
  if (!(typeof parsed.data['title'] === 'string' && parsed.data['title'].trim())) {
    return invalid('frontmatter must include title')
  }

  const enabled = parsed.data['enabled'] !== false
  const scheduleText =
    typeof parsed.data['schedule'] === 'string' && parsed.data['schedule'].trim()
      ? parsed.data['schedule'].trim()
      : null
  if (!scheduleText) return invalid('frontmatter must include schedule')
  const schedule = parsePulseSchedule(scheduleText)
  if (!schedule) return invalid(`invalid schedule: ${scheduleText}`)

  const title = parsed.data['title'].trim()

  return {
    status: 'valid',
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
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  }
}

async function readHomePulses(options: {
  repoRoot: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
}): Promise<PulseCatalogItem[]> {
  const dir = join(options.ownerHome, 'pulses')
  if (!(await pathExists(dir))) return []
  const folders = await listPulseFolders(dir)
  return await Promise.all(folders.map((pulseHome) => readPulseFolder({ ...options, pulseHome })))
}

export async function discoverPulseCatalog(cwd: string): Promise<PulseCatalogItem[]> {
  const repoRoot = findRepoRoot(cwd)
  const definitions: PulseCatalogItem[] = []
  definitions.push(
    ...(await readHomePulses({
      repoRoot,
      ownerId: 'main',
      ownerTitle: 'Main Clawa',
      ownerHome: repoRoot,
    })),
  )

  const config = await loadClawasConfig(repoRoot)
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

export async function discoverPulseDefinitions(cwd: string): Promise<PulseDefinition[]> {
  const definitions = await discoverPulseCatalog(cwd)
  return definitions.filter(
    (definition): definition is PulseDefinition => definition.status === 'valid',
  )
}

export function getPulseStatePath(cwd: string): string {
  return join(findRepoRoot(cwd), '.pi', 'pulses.json')
}
