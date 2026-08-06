import { access } from 'node:fs/promises'
import { findRepoRoot, getClawEnvironmentConfigPath, loadClawEnvironmentConfig } from '../config.js'
import type { ClawasConfig } from './types.js'

export function getClawasConfigPath(projectRoot: string): string {
  return getClawEnvironmentConfigPath(findRepoRoot(projectRoot))
}

export async function loadClawasConfig(projectRoot: string): Promise<ClawasConfig | null> {
  const repoRoot = findRepoRoot(projectRoot)
  try {
    await access(getClawEnvironmentConfigPath(repoRoot))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }

  const loaded = loadClawEnvironmentConfig(repoRoot)
  return { workers: loaded.config.clawas.workers.filter((worker) => worker.enabled) }
}
