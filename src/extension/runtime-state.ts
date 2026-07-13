import { ensureClawEnvironmentConfig, findRepoRoot, loadClawEnvironmentConfig } from '../config.js'
import type { HydratedClawaImage } from '../hydration-image.js'
import { IS_CLAWAS_WORKER } from './constants.js'

export type ExtensionConfigStatus = {
  bootstrapped: boolean
  created: boolean
  path: string
}

export class ClawaRuntimeState {
  cwd?: string
  extensionBootstrapped = true
  bootstrappedKnown = false
  bootstrapped = false
  hydrationStale = false
  hydrationText: string | undefined = undefined
  hydrationImage: HydratedClawaImage | undefined = undefined

  async armHydration(cwd: string): Promise<boolean> {
    await this.ensureBootstrapped(cwd)
    this.hydrationStale = true
    return this.bootstrapped
  }

  ensureBootstrapped(cwd: string): boolean {
    if (this.cwd !== cwd) {
      this.cwd = cwd
      this.bootstrappedKnown = false
      this.bootstrapped = false
      this.hydrationStale = false
      this.hydrationText = undefined
      this.hydrationImage = undefined
    }
    if (!this.bootstrappedKnown) {
      this.bootstrapped = loadClawEnvironmentConfig(findRepoRoot(cwd)).config.bootstrapped === true
      this.bootstrappedKnown = true
    }
    return this.bootstrapped
  }

  ensureExtensionConfig(cwd: string): ExtensionConfigStatus {
    if (IS_CLAWAS_WORKER) {
      this.extensionBootstrapped = true
      return { bootstrapped: true, created: false, path: '' }
    }

    const repoRoot = findRepoRoot(cwd)
    const loaded = ensureClawEnvironmentConfig(repoRoot)
    this.extensionBootstrapped = loaded.config.bootstrapped === true
    return {
      bootstrapped: this.extensionBootstrapped,
      created: loaded.created,
      path: loaded.path,
    }
  }

  markBootstrapped(cwd: string): void {
    this.cwd = cwd
    this.bootstrappedKnown = true
    this.bootstrapped = true
    this.hydrationStale = true
    this.extensionBootstrapped = true
  }
}
