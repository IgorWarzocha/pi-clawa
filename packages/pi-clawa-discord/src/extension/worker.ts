import { copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { getClawasConfigPath } from '@howaboua/pi-clawa/clawas/config-loader'
import { ensureClawEnvironmentConfig } from '@howaboua/pi-clawa/config'
import {
  adapterEntryPath,
  DISCORD_WORKER_CWD,
  DISCORD_WORKER_ID,
  DISCORD_WORKER_TITLE,
  extensionDir,
  STRIP_BLOCK_COMMENT_REGEX,
  STRIP_LINE_COMMENT_REGEX,
  STRIP_TRAILING_COMMA_REGEX,
} from './constants.js'

function projectRelativePath(projectRoot: string, targetPath: string): string {
  return relative(projectRoot, targetPath) || targetPath
}

async function symlinkSharedFile(
  projectRoot: string,
  targetDir: string,
  filename: 'HUMAN.md' | 'CLAWAS.md',
): Promise<void> {
  const linkPath = join(targetDir, filename)
  const targetPath = join(projectRoot, filename)
  const relativeTarget = relative(targetDir, targetPath) || filename
  await rm(linkPath, { force: true })
  await symlink(relativeTarget, linkPath)
}

async function copyDiscordWorkerTemplates(projectRoot: string, targetDir: string): Promise<void> {
  const templateDir = join(extensionDir, 'templates', 'discord-worker')
  await mkdir(targetDir, { recursive: true })
  for (const file of ['AGENTS.md', 'CLAW.md', 'TOOLS.md', 'CURIOUS.md']) {
    await copyFile(join(templateDir, file), join(targetDir, file))
  }
  await symlinkSharedFile(projectRoot, targetDir, 'HUMAN.md')
  await symlinkSharedFile(projectRoot, targetDir, 'CLAWAS.md')
}

function stripJsonc(text: string): string {
  return text
    .replace(STRIP_BLOCK_COMMENT_REGEX, '')
    .replace(STRIP_LINE_COMMENT_REGEX, '')
    .replace(STRIP_TRAILING_COMMA_REGEX, '$1')
}

async function loadClawasConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(stripJsonc(await readFile(configPath, 'utf8'))) as Record<string, unknown>
  } catch {
    return { clawas: { workers: [] } }
  }
}

function getWorkers(config: Record<string, unknown>): unknown[] {
  const clawas = config['clawas']
  if (!(clawas && typeof clawas === 'object')) return []
  const workers = (clawas as Record<string, unknown>)['workers']
  return Array.isArray(workers) ? [...workers] : []
}

function setWorkers(config: Record<string, unknown>, workers: unknown[]): void {
  const clawas = config['clawas'] && typeof config['clawas'] === 'object' ? config['clawas'] : {}
  config['clawas'] = { ...(clawas as Record<string, unknown>), workers }
}

function isWorkerEntry(entry: unknown): entry is Record<string, unknown> {
  return Boolean(entry && typeof entry === 'object')
}

function readExtensions(current: Record<string, unknown>, adapterExtension: string): string[] {
  const extensions = new Set(
    Array.isArray(current['extensions'])
      ? current['extensions'].filter((entry): entry is string => typeof entry === 'string')
      : [],
  )
  extensions.add(adapterExtension)
  return [...extensions]
}

function buildDiscordWorker(current: Record<string, unknown>, adapterExtension: string) {
  return {
    ...current,
    id: DISCORD_WORKER_ID,
    title: typeof current['title'] === 'string' ? current['title'] : DISCORD_WORKER_TITLE,
    emoji: typeof current['emoji'] === 'string' ? current['emoji'] : '💬',
    cwd: typeof current['cwd'] === 'string' ? current['cwd'] : DISCORD_WORKER_CWD,
    enabled: true,
    autostart: current['autostart'] !== false,
    discordEnabled: true,
    reportMode: typeof current['reportMode'] === 'string' ? current['reportMode'] : 'explicit',
    extensions: readExtensions(current, adapterExtension),
    startupPrompt:
      typeof current['startupPrompt'] === 'string'
        ? current['startupPrompt']
        : 'Wake up in the Discord lane. Your home context is already loaded; stay public-safe, warm, and ready for Discord turns.',
  }
}

export async function ensureDiscordWorker(projectRoot: string): Promise<void> {
  ensureClawEnvironmentConfig(projectRoot)
  const configPath = getClawasConfigPath(projectRoot)
  const config = await loadClawasConfig(configPath)
  const workers = getWorkers(config)
  const adapterExtension = projectRelativePath(projectRoot, adapterEntryPath)
  const existingIndex = workers.findIndex(
    (entry) => isWorkerEntry(entry) && entry['id'] === DISCORD_WORKER_ID,
  )
  const current =
    existingIndex >= 0 && isWorkerEntry(workers[existingIndex]) ? workers[existingIndex] : {}
  const worker = buildDiscordWorker(current, adapterExtension)

  if (existingIndex >= 0) workers[existingIndex] = worker
  else workers.push(worker)

  setWorkers(config, workers)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await copyDiscordWorkerTemplates(projectRoot, resolve(projectRoot, worker['cwd']))
}
