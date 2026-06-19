import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { type ClawaDefaults, DEFAULT_CLAWA_DEFAULTS, resolveClawaDefaults } from '../config'
import { resolveSocketPath } from './comms/paths.js'
import { CLAWAS_SPINNER_TICK_MS } from './config.js'
import { getClawasConfigPath, loadClawasConfig } from './config-loader.js'
import { ClawasDaemon } from './daemon.js'
import { ClawasManualSessionLauncher } from './manual-session-launcher.js'
import {
  createClawasMonitorState,
  findMonitorWorker,
  getActiveMonitorWorker,
  getMonitorWorkerBySlot,
  selectMonitorWorker,
  selectRelativeMonitorWorker,
} from './monitor-state.js'
import { ClawasUiBridge } from './runtime-ui.js'
import type { ClawasConfig, ClawasState, WorkerDefinition, WorkerState } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

function shouldProbeManualSession(worker: WorkerState): boolean {
  return worker.manualSession && Date.now() - worker.updatedAt >= 5_000
}

/**
 * Thin UI/runtime shell around the daemon.
 * It keeps widget lifecycle and repaint timing out of the worker orchestration code.
 */
export class ClawasRuntime {
  private context: ExtensionContext | null = null
  private daemon: ClawasDaemon | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private manualWatcher: ReturnType<typeof setInterval> | null = null
  private manualWatchInFlight = false
  private daemonStarted = false
  private clawaDefaults: ClawaDefaults = DEFAULT_CLAWA_DEFAULTS
  private monitorState = createClawasMonitorState()
  private readonly ui = new ClawasUiBridge()
  private readonly launcher = new ClawasManualSessionLauncher()

  attach(context: ExtensionContext): void {
    this.context = context
    this.clawaDefaults = resolveClawaDefaults(context.cwd)
    if (!context.hasUI) {
      return
    }

    void this.launcher.captureCurrentHostPane().catch(() => {
      // Manual takeover stays unavailable until Herdr/tmux context is captured.
    })
    this.ui.clear(context)
    void this.startOrReloadDaemon(context, false).catch(() => {
      // User-facing error notification is emitted inside startOrReloadDaemon.
    })
    this.render()
  }

  getClawaDefaults(): ClawaDefaults {
    return this.clawaDefaults
  }

  async restart(): Promise<void> {
    if (!this.context) {
      return
    }

    await this.startOrReloadDaemon(this.context, true)
    this.render()
  }

  async sendPrompt(
    workerId: string,
    message: string,
    mode: 'prompt' | 'steer' | 'followUp' = 'prompt',
  ): Promise<void> {
    const daemon = this.requireDaemon()
    await daemon.sendPrompt(workerId, message, mode)
    this.render()
  }

  async getLastAssistantText(workerId: string): Promise<string | null> {
    if (!this.daemon) {
      return null
    }
    return await this.daemon.getLastAssistantText(workerId)
  }

  getState(): ClawasState | null {
    return this.daemon?.getState() ?? null
  }

  async ensureWorkerRunning(workerId: string): Promise<void> {
    const daemon = this.requireDaemon()
    await daemon.ensureWorkerRunning(workerId)
    this.render()
  }

  isWorkerManual(workerId: string): boolean {
    return this.daemon?.isWorkerManual(workerId) ?? false
  }

  getWorkerIds(): string[] {
    return this.daemon?.getWorkerIds() ?? []
  }

  getWorkerDefinition(workerId: string): WorkerDefinition {
    return this.requireDaemon().getWorkerDefinition(workerId)
  }

  getActiveMonitorWorker(): WorkerState | undefined {
    return getActiveMonitorWorker(this.daemon?.getState(), this.monitorState)
  }

  getMonitorWorkerBySlot(slot: number): WorkerState | undefined {
    return getMonitorWorkerBySlot(this.daemon?.getState(), slot)
  }

  findMonitorWorker(target: string): WorkerState | undefined {
    return findMonitorWorker(this.daemon?.getState(), target)
  }

  selectMonitorWorker(workerId: string): void {
    this.monitorState = selectMonitorWorker(this.daemon?.getState(), this.monitorState, workerId)
    this.render()
  }

  selectRelativeMonitorWorker(direction: number): void {
    this.monitorState = selectRelativeMonitorWorker(
      this.daemon?.getState(),
      this.monitorState,
      direction,
    )
    this.render()
  }

  toggleMonitorFold(): void {
    this.monitorState = { ...this.monitorState, folded: !this.monitorState.folded }
    this.render()
  }

  async openWorkerPanel(workerId: string): Promise<string> {
    const daemon = this.requireDaemon()
    const definition = daemon.getWorkerDefinition(workerId)
    const cwd = this.getWorkerCwd(workerId)
    const sessionFile = await daemon.getWorkerSessionFile(workerId)
    // We stop the managed worker before opening the human-owned pane so there is
    // exactly one live session for that claw. If launch fails, we restore it.
    await daemon.stopWorker(workerId)
    try {
      const handle = await this.launcher.openPanel({
        definition,
        cwd,
        extensionPaths: this.daemonExtensionPaths(workerId),
        clawaDefaults: this.clawaDefaults,
        sessionFile,
      })
      await daemon.markWorkerDetached(workerId, 'manual session')
      this.render()
      return handle
    } catch (error) {
      await daemon.ensureWorkerRunning(workerId)
      this.render()
      throw new Error(
        `Failed to open manual panel for ${definition.title}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async openWorkerWindow(workerId: string): Promise<string> {
    const daemon = this.requireDaemon()
    const definition = daemon.getWorkerDefinition(workerId)
    const cwd = this.getWorkerCwd(workerId)
    const sessionFile = await daemon.getWorkerSessionFile(workerId)
    await daemon.stopWorker(workerId)
    try {
      const handle = await this.launcher.openWindow({
        definition,
        cwd,
        extensionPaths: this.daemonExtensionPaths(workerId),
        clawaDefaults: this.clawaDefaults,
        sessionFile,
      })
      await daemon.markWorkerDetached(workerId, 'manual session')
      this.render()
      return handle
    } catch (error) {
      await daemon.ensureWorkerRunning(workerId)
      this.render()
      throw new Error(
        `Failed to open manual window for ${definition.title}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  canOpenManualPanel(): boolean {
    return this.launcher.canOpenPanel()
  }

  getManualPanelHostLabel(): string | null {
    return this.launcher.getHostLabel()
  }

  async dispose(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval)
    }
    if (this.manualWatcher) {
      clearInterval(this.manualWatcher)
    }
    this.interval = null
    this.manualWatcher = null
    if (this.daemon) {
      await this.daemon.dispose()
      this.daemon = null
    }
    this.daemonStarted = false
    if (this.context?.hasUI) {
      this.ui.clear(this.context)
    }
    this.context = null
  }

  private async startOrReloadDaemon(
    context: ExtensionContext,
    replaceExisting: boolean,
  ): Promise<void> {
    this.clawaDefaults = resolveClawaDefaults(context.cwd)
    const configPath = getClawasConfigPath(context.cwd)
    const config = await this.loadConfigOrNotify(context, configPath)

    if (!config) {
      await this.clearMissingConfig(replaceExisting)
      return
    }

    if (replaceExisting) {
      await this.disposeDaemon(true)
    }

    if (this.daemonStarted && this.daemon) {
      return
    }

    this.createDaemon(context, config)

    try {
      await this.daemon.start()
      this.notifyDaemonStarted(configPath)
    } catch (error) {
      this.notifyDaemonFailed(error)
      throw error
    }
  }

  private async loadConfigOrNotify(
    context: ExtensionContext,
    configPath: string,
  ): Promise<ClawasConfig | null> {
    try {
      return await loadClawasConfig(context.cwd)
    } catch (error) {
      if (context.hasUI) {
        context.ui.notify(
          `Failed to load ${this.clawaDefaults.clawasName} config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
      }
      throw error
    }
  }

  private async clearMissingConfig(replaceExisting: boolean): Promise<void> {
    await this.disposeDaemon(replaceExisting)
    if (this.context?.hasUI) this.ui.clear(this.context)
  }

  private createDaemon(context: ExtensionContext, config: ClawasConfig): void {
    this.daemon = new ClawasDaemon(context.cwd, config, () => this.render(), this.clawaDefaults)
    this.daemonStarted = true
    this.ensureStarted()
    this.ui.showMonitor(
      context,
      () => this.daemon?.getState(),
      () => this.monitorState,
      this.clawaDefaults,
    )
  }

  private notifyDaemonStarted(configPath: string): void {
    if (!(this.context?.hasUI && this.daemon)) return
    const workerCount = this.daemon.getState().workers.length
    this.context.ui.notify(
      `${this.clawaDefaults.clawasName} loaded ${workerCount} worker${workerCount === 1 ? '' : 's'} from ${configPath}.`,
      'info',
    )
  }

  private notifyDaemonFailed(error: unknown): void {
    this.daemonStarted = false
    if (!this.context?.hasUI) return
    this.context.ui.notify(
      `${this.clawaDefaults.clawasName} daemon failed: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }

  private ensureStarted(): void {
    if (!this.interval) {
      this.interval = setInterval(() => {
        this.render()
      }, CLAWAS_SPINNER_TICK_MS)
      this.interval.unref?.()
    }

    if (!this.manualWatcher) {
      // Manual sessions clear themselves when their comms socket disappears.
      // That keeps the Clawas hands-off while a human is in the pane, but lets
      // the worker slide back under daemon control after the pane is closed.
      this.manualWatcher = setInterval(() => {
        void this.refreshManualSessions()
      }, 1_000)
      this.manualWatcher.unref?.()
    }
  }

  private async disposeDaemon(clearIntervalToo: boolean): Promise<void> {
    if (clearIntervalToo && this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (clearIntervalToo && this.manualWatcher) {
      clearInterval(this.manualWatcher)
      this.manualWatcher = null
    }
    if (this.daemon) {
      await this.daemon.dispose()
      this.daemon = null
    }
    this.daemonStarted = false
  }

  private render(): void {
    if (!(this.context?.hasUI && this.daemon)) {
      return
    }

    this.ui.showMonitor(
      this.context,
      () => this.daemon?.getState(),
      () => this.monitorState,
      this.clawaDefaults,
    )
  }

  private async refreshManualSessions(): Promise<void> {
    if (!this.daemon || this.manualWatchInFlight) {
      return
    }

    this.manualWatchInFlight = true
    try {
      for (const worker of this.daemon.getState().workers) {
        if (shouldProbeManualSession(worker)) await this.refreshManualSession(worker)
      }
    } finally {
      this.manualWatchInFlight = false
    }
  }

  private async refreshManualSession(worker: WorkerState): Promise<void> {
    if (!this.daemon) return
    try {
      // We wait a little before checking so a freshly opened manual session
      // has time to publish its alias/socket before we declare it gone.
      const socketPath = await resolveSocketPath(getWorkerSocketAlias(worker.definition))
      if (!socketPath) this.daemon.clearManualSession(worker.definition.id)
    } catch (error) {
      this.notifyManualWatcherError(worker, error)
    }
  }

  private notifyManualWatcherError(worker: WorkerState, error: unknown): void {
    if (!this.context?.hasUI) return
    this.context.ui.notify(
      `${this.clawaDefaults.clawasName} manual-session watcher hit an error for ${worker.definition.title}: ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    )
  }

  private requireDaemon(): ClawasDaemon {
    if (!this.daemon) {
      throw new Error(`${this.clawaDefaults.clawasName} daemon is not running`)
    }
    return this.daemon
  }

  private getWorkerCwd(workerId: string): string {
    return this.requireDaemon().getWorkerCwd(workerId)
  }

  private daemonExtensionPaths(workerId?: string): string[] {
    return this.requireDaemon().getExtensionPaths(workerId)
  }
}
