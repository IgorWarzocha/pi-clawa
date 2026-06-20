import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawaDefaults } from '../config'
import { resolveSocketPath } from './comms/paths.js'
import type { ClawasDaemon } from './daemon.js'
import type { WorkerState } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

function shouldProbeManualSession(worker: WorkerState): boolean {
  return worker.manualSession === true && Date.now() - worker.updatedAt >= 5_000
}

export class ManualSessionWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight = false
  private readonly getDaemon: () => ClawasDaemon | null
  private readonly getContext: () => ExtensionContext | null
  private readonly getDefaults: () => ClawaDefaults

  constructor(
    getDaemon: () => ClawasDaemon | null,
    getContext: () => ExtensionContext | null,
    getDefaults: () => ClawaDefaults,
  ) {
    this.getDaemon = getDaemon
    this.getContext = getContext
    this.getDefaults = getDefaults
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.refresh()
    }, 1_000)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async refresh(): Promise<void> {
    const daemon = this.getDaemon()
    if (!daemon || this.inFlight) return

    this.inFlight = true
    try {
      for (const worker of daemon.getState().workers) {
        if (shouldProbeManualSession(worker)) await this.refreshWorker(daemon, worker)
      }
    } finally {
      this.inFlight = false
    }
  }

  private async refreshWorker(daemon: ClawasDaemon, worker: WorkerState): Promise<void> {
    try {
      const socketPath = await resolveSocketPath(getWorkerSocketAlias(worker.definition))
      if (!socketPath) daemon.clearManualSession(worker.definition.id)
    } catch (error) {
      this.notifyError(worker, error)
    }
  }

  private notifyError(worker: WorkerState, error: unknown): void {
    const context = this.getContext()
    if (!context?.hasUI) return
    const defaults = this.getDefaults()
    context.ui.notify(
      `${defaults.clawasName} manual-session watcher hit an error for ${worker.definition.title}: ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    )
  }
}
