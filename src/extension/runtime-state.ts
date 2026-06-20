import { ensureClawEnvironmentConfig, findRepoRoot, loadClawEnvironmentConfig } from '../config.js'
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
  needsHydrate = false

  async armHydration(cwd: string): Promise<boolean> {
    await this.ensureBootstrapped(cwd)
    this.needsHydrate = true
    return this.bootstrapped
  }

  ensureBootstrapped(cwd: string): boolean {
    if (this.cwd !== cwd) {
      this.cwd = cwd
      this.bootstrappedKnown = false
      this.bootstrapped = false
      this.needsHydrate = false
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
    this.needsHydrate = true
    this.extensionBootstrapped = true
  }
}
