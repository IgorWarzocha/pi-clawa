import { ensureClawEnvironmentConfig, findRepoRoot, loadClawEnvironmentConfig } from '../config.js'
import { IS_CLAWAS_WORKER } from './constants.js'

export type ExtensionConfigStatus = {
  bootstrapped: boolean
  created: boolean
  path: string
}

export class ClawaRuntimeState {
  active = false
  homeRoot: string | undefined = undefined
  onboardingPending = false
  cwd?: string
  bootstrappedKnown = false
  bootstrapped = false

  ensureBootstrapped(cwd: string): boolean {
    if (this.cwd !== cwd) {
      this.cwd = cwd
      this.bootstrappedKnown = false
      this.bootstrapped = false
    }
    if (!this.bootstrappedKnown) {
      const homeRoot =
        this.homeRoot || process.env['PI_CLAW_PROJECT_ROOT']?.trim() || findRepoRoot(cwd)
      this.bootstrapped = loadClawEnvironmentConfig(homeRoot).config.bootstrapped === true
      this.bootstrappedKnown = true
    }
    return this.bootstrapped
  }

  ensureExtensionConfig(cwd: string): ExtensionConfigStatus {
    if (IS_CLAWAS_WORKER) {
      return { bootstrapped: true, created: false, path: '' }
    }

    const repoRoot = this.homeRoot || findRepoRoot(cwd)
    const loaded = ensureClawEnvironmentConfig(repoRoot)
    return {
      bootstrapped: loaded.config.bootstrapped === true,
      created: loaded.created,
      path: loaded.path,
    }
  }

  markBootstrapped(cwd: string): void {
    this.cwd = cwd
    this.bootstrappedKnown = true
    this.bootstrapped = true
  }
}
