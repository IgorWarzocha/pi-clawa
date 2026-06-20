import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
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
  relativeFile: string
  absoluteFile: string
  scheduleText: string
  schedule: PulseSchedule
  enabled: boolean
  body: string
}

const PULSE_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.md$/u
const MARKDOWN_H1_PATTERN = /^#\s+(.+)$/mu
const MARKDOWN_SUFFIX_PATTERN = /\.md$/u

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(MARKDOWN_H1_PATTERN)?.[1]?.trim()
  if (heading) return heading
  return fallback
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

async function readPulseFile(options: {
  repoRoot: string
  ownerId: 'main' | string
  ownerTitle: string
  ownerHome: string
  file: string
}): Promise<PulseDefinition | null> {
  if (!PULSE_FILE_PATTERN.test(basename(options.file))) return null
  if (basename(options.file) === 'AGENTS.md') return null

  const text = await readFile(options.file, 'utf8')
  const parsed = parsePulseFrontmatter(text)
  if (!(typeof parsed.data['title'] === 'string' && parsed.data['title'].trim())) return null

  const enabled = parsed.data['enabled'] !== false
  const scheduleText =
    typeof parsed.data['schedule'] === 'string' && parsed.data['schedule'].trim()
      ? parsed.data['schedule'].trim()
      : 'manual'
  const schedule = parsePulseSchedule(scheduleText)
  if (!(enabled && schedule)) return null

  const pulsesDir = join(options.ownerHome, 'pulses')
  const id = relative(pulsesDir, options.file)
    .replaceAll(sep, '/')
    .replace(MARKDOWN_SUFFIX_PATTERN, '')
  const title = parsed.data['title'].trim() || titleFromBody(parsed.body, id)

  return {
    key: `${options.ownerId}:${id}`,
    id,
    title,
    ownerId: options.ownerId,
    ownerTitle: options.ownerTitle,
    ownerHome: options.ownerHome,
    relativeFile: relative(options.repoRoot, options.file),
    absoluteFile: options.file,
    scheduleText,
    schedule,
    enabled,
    body: parsed.body,
  }
}

async function listPulseFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listPulseFiles(path)))
        continue
      }
      if (entry.isFile() && PULSE_FILE_PATTERN.test(entry.name) && entry.name !== 'AGENTS.md') {
        files.push(path)
      }
    }
    return files.sort()
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
  const files = await listPulseFiles(dir)
  const definitions = await Promise.all(files.map((file) => readPulseFile({ ...options, file })))
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
