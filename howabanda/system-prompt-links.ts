import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { HowabandaConfig, WorkerDefinition, WorkerPromptProfile } from './types.js'

type ResolvedWorkerPromptProfile = Exclude<WorkerPromptProfile, 'auto'>

export interface SyncedWorkerPromptLink {
  workerId: string
  profile: ResolvedWorkerPromptProfile
  linkPath: string
  targetPath: string
  changed: boolean
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

function getPromptTargetPath(projectRoot: string, profile: ResolvedWorkerPromptProfile): string {
  return path.join(projectRoot, '.pi', 'system-prompts', `howabanda-${profile}.md`)
}

export function resolveWorkerPromptProfile(
  definition: WorkerDefinition,
): ResolvedWorkerPromptProfile {
  if (definition.promptProfile && definition.promptProfile !== 'auto') {
    return definition.promptProfile
  }

  if (definition.discordEnabled) {
    return 'discord'
  }

  const model = definition.model?.trim().toLowerCase() ?? ''
  if (model.startsWith('zai/') || model.includes('glm')) {
    return 'glm'
  }

  return 'gpt'
}

async function ensurePromptLink(linkPath: string, targetPath: string): Promise<boolean> {
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  try {
    const stat = await fs.lstat(linkPath)
    if (stat.isSymbolicLink()) {
      const existingTarget = await fs.readlink(linkPath)
      if (
        existingTarget === relativeTarget ||
        path.resolve(path.dirname(linkPath), existingTarget) === targetPath
      ) {
        return false
      }
    }
    await fs.unlink(linkPath)
  } catch (error) {
    if (isErrnoException(error) && error.code !== 'ENOENT') {
      throw error
    }
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true })
  await fs.symlink(relativeTarget, linkPath)
  return true
}

export async function syncHowabandaSystemPromptLinks(
  projectRoot: string,
  config: HowabandaConfig,
): Promise<SyncedWorkerPromptLink[]> {
  const results: SyncedWorkerPromptLink[] = []

  for (const worker of config.workers) {
    const profile = resolveWorkerPromptProfile(worker)
    const targetPath = getPromptTargetPath(projectRoot, profile)
    await fs.access(targetPath)

    const linkPath = path.join(projectRoot, worker.cwd, '.pi', 'SYSTEM.md')
    const changed = await ensurePromptLink(linkPath, targetPath)
    results.push({
      workerId: worker.id,
      profile,
      linkPath,
      targetPath,
      changed,
    })
  }

  return results
}
