import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { type ClawaDefaults, DEFAULT_CLAWA_DEFAULTS, resolveClawaDefaults } from '../config'
import { CLAWAS_SPINNER_TICK_MS } from './config.js'
import { getClawasConfigPath, loadClawasConfig } from './config-loader.js'
import { ClawasDaemon } from './daemon.js'
import { ClawasManualSessionLauncher } from './manual-session-launcher.js'
import { ManualSessionWatcher } from './manual-session-watcher.js'
import {
  createClawasMonitorState,
  findMonitorWorker,
  getActiveMonitorWorker,
  getMonitorWorkerBySlot,
  selectMonitorWorker,
  selectRelativeMonitorWorker,
} from './monitor-state.js'
import { openWorkerManualSession } from './runtime-manual.js'
import { ClawasUiBridge } from './runtime-ui.js'
import type { ClawasConfig, ClawasState, WorkerDefinition } from './types.js'

/**
 * Thin UI/runtime shell around the daemon.
 * It keeps widget lifecycle and repaint timing out of the worker orchestration code.
 */
export class ClawasRuntime {
  private context: ExtensionContext | null = null
  private daemon: ClawasDaemon | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private daemonStarted = false
  private clawaDefaults: ClawaDefaults = DEFAULT_CLAWA_DEFAULTS
  private monitorState = createClawasMonitorState()
  private readonly ui = new ClawasUiBridge()
  private readonly launcher = new ClawasManualSessionLauncher()
  private readonly manualWatcher = new ManualSessionWatcher(
    () => this.daemon,
    () => this.context,
    () => this.clawaDefaults,
  )

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
    return await this.openWorkerManualSession(workerId, 'panel')
  }

  async openWorkerWindow(workerId: string): Promise<string> {
    return await this.openWorkerManualSession(workerId, 'window')
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
    this.manualWatcher.stop()
    this.interval = null
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

    this.manualWatcher.start()
  }

  private async disposeDaemon(clearIntervalToo: boolean): Promise<void> {
    if (clearIntervalToo && this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (clearIntervalToo) {
      this.manualWatcher.stop()
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

  private async openWorkerManualSession(
    workerId: string,
    mode: 'panel' | 'window',
  ): Promise<string> {
    return await openWorkerManualSession({
      mode,
      workerId,
      daemon: this.requireDaemon(),
      launcher: this.launcher,
      clawaDefaults: this.clawaDefaults,
      getExtensionPaths: (id) => this.daemonExtensionPaths(id),
      render: () => this.render(),
    })
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
