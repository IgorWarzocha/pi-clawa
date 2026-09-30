import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { findRepoRoot, getClawEnvironmentConfigPath, loadClawEnvironmentConfig } from '../config.js'

function canonical(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path)
}

function contains(root: string, cwd: string): boolean {
  const path = relative(root, cwd)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function configuredHome(cwd: string): string | undefined {
  let root = cwd
  while (true) {
    if (existsSync(getClawEnvironmentConfigPath(root))) return root
    const parent = dirname(root)
    if (parent === root) return undefined
    root = parent
  }
}

/** Inherited worker environment is a hint, never permission to claim an unrelated directory. */
export function resolveActiveHome(
  cwd: string,
  scope: 'user' | 'project' | 'temporary' | undefined,
  inheritedRoot = process.env['PI_CLAW_PROJECT_ROOT']?.trim(),
): string | undefined {
  const current = canonical(cwd)
  const configured = configuredHome(current)
  if (configured) return configured
  if (inheritedRoot) {
    const root = canonical(inheritedRoot)
    if (existsSync(getClawEnvironmentConfigPath(root))) {
      if (contains(root, current)) return root
      const workers = loadClawEnvironmentConfig(root).config.clawas.workers
      if (
        workers.some(
          (worker) => worker.enabled && contains(canonical(resolve(root, worker.cwd)), current),
        )
      )
        return root
    }
  }
  const root = canonical(findRepoRoot(current))
  // Project installs and explicit -e launches deliberately opt this folder into Clawa.
  return scope === 'project' || scope === 'temporary' ? root : undefined
}

export function clawaInstallScope(pi: ExtensionAPI) {
  return pi
    .getCommands()
    .find((command) => command.name === 'claw' && command.source === 'extension')?.sourceInfo?.scope
}
