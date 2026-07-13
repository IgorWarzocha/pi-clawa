import { constants, realpathSync } from 'node:fs'
import { copyFile, mkdir, symlink } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import {
  type ClawaWorkerConfig,
  ensureClawEnvironmentConfig,
  getClawEnvironmentConfigPath,
  loadClawEnvironmentConfig,
  upsertClawaWorkerConfig,
} from '@howaboua/pi-clawa/config'
import {
  adapterEntryPath,
  DISCORD_WORKER_CWD,
  DISCORD_WORKER_ID,
  DISCORD_WORKER_TITLE,
  extensionDir,
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
  try {
    await symlink(relativeTarget, linkPath)
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function copyDiscordWorkerTemplates(projectRoot: string, targetDir: string): Promise<void> {
  const templateDir = join(extensionDir, 'templates', 'discord-worker')
  await mkdir(targetDir, { recursive: true })
  for (const file of ['AGENTS.md', 'CLAW.md', 'TOOLS.md', 'CURIOUS.md']) {
    const targetPath = join(targetDir, file)
    try {
      await copyFile(join(templateDir, file), targetPath, constants.COPYFILE_EXCL)
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
    }
  }
  await symlinkSharedFile(projectRoot, targetDir, 'HUMAN.md')
  await symlinkSharedFile(projectRoot, targetDir, 'CLAWAS.md')
}

function readExtensions(
  projectRoot: string,
  current: Partial<ClawaWorkerConfig>,
  adapterExtension: string,
): string[] {
  const extensions: string[] = []
  const resolved = new Set<string>()
  for (const extension of [...(current.extensions ?? []), adapterExtension]) {
    const absolutePath = resolve(projectRoot, extension)
    let identity = absolutePath
    try {
      identity = realpathSync(absolutePath)
    } catch {
      // Preserve configured missing paths; they may become available later.
    }
    if (resolved.has(identity)) continue
    resolved.add(identity)
    extensions.push(extension)
  }
  return extensions
}

function buildDiscordWorker(
  projectRoot: string,
  current: Partial<ClawaWorkerConfig>,
  adapterExtension: string,
): ClawaWorkerConfig {
  return {
    ...current,
    id: DISCORD_WORKER_ID,
    title: current.title ?? DISCORD_WORKER_TITLE,
    emoji: current.emoji ?? '💬',
    cwd: current.cwd ?? DISCORD_WORKER_CWD,
    enabled: true,
    autostart: current.autostart !== false,
    discordEnabled: true,
    reportMode: current.reportMode ?? 'explicit',
    extensions: readExtensions(projectRoot, current, adapterExtension),
    startupPrompt:
      current.startupPrompt ??
      'Wake up in the Discord lane. Your home context is already loaded; stay public-safe, warm, and ready for Discord turns.',
  }
}

export async function ensureDiscordWorker(projectRoot: string): Promise<void> {
  ensureClawEnvironmentConfig(projectRoot)
  const configPath = getClawEnvironmentConfigPath(projectRoot)
  const workers = loadClawEnvironmentConfig(projectRoot).config.clawas.workers
  const adapterExtension = projectRelativePath(projectRoot, adapterEntryPath)
  const current = workers.find((entry) => entry.id === DISCORD_WORKER_ID) ?? {}
  const worker = buildDiscordWorker(projectRoot, current, adapterExtension)

  upsertClawaWorkerConfig(projectRoot, worker)
  await mkdir(dirname(configPath), { recursive: true })
  await copyDiscordWorkerTemplates(projectRoot, resolve(projectRoot, worker['cwd']))
}
