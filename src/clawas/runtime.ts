import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { type ClawaDefaults, DEFAULT_CLAWA_DEFAULTS, resolveClawaDefaults } from '../config.js'
import { CLAWAS_SPINNER_TICK_MS } from './config.js'
import { getClawasConfigPath, loadClawasConfig } from './config-loader.js'
import { ClawasController } from './controller.js'
import {
  createClawasMonitorState,
  findMonitorWorker,
  getActiveMonitorWorker,
  getMonitorWorkerBySlot,
  selectMonitorWorker,
  selectRelativeMonitorWorker,
} from './monitor-state.js'
import { ClawasPanelLauncher } from './panel-launcher.js'
import { ClawasUiBridge } from './runtime-ui.js'
import type { PrepareResidentContext } from './shared-context.js'
import type { ClawasState, WorkerDefinition, WorkerState } from './types.js'

/** Main-session configuration and UI lifecycle. Reloading reconnects, never closes worker tabs. */
export class ClawasRuntime {
  private context: ExtensionContext | null = null
  private controller: ClawasController | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private configFingerprint: string | null = null
  private lifecycle: Promise<void> = Promise.resolve()
  private clawaDefaults: ClawaDefaults = DEFAULT_CLAWA_DEFAULTS
  private monitorState = createClawasMonitorState()
  private readonly ui = new ClawasUiBridge()
  private readonly launcher = new ClawasPanelLauncher()
  private readonly prepareResidentContext: (
    context: ExtensionContext,
    workerId: string,
  ) => ReturnType<PrepareResidentContext>

  constructor(
    prepareResidentContext: (
      context: ExtensionContext,
      workerId: string,
    ) => ReturnType<PrepareResidentContext> = async () => undefined,
  ) {
    this.prepareResidentContext = prepareResidentContext
  }

  attach(context: ExtensionContext): void {
    this.context = context
    this.clawaDefaults = resolveClawaDefaults(context.cwd)
    if (!context.hasUI) return
    this.ui.clear(context)
    void this.queueLifecycle(async () => {
      if (this.context === context) await this.loadController(context, false)
    }).catch(() => {
      /* loadController reports the failure. */
    })
  }

  getClawaDefaults(): ClawaDefaults {
    return this.clawaDefaults
  }

  async restart(): Promise<void> {
    await this.refresh(true)
  }
  async refreshFromConfig(): Promise<void> {
    await this.refresh(false)
  }

  private async refresh(reconnect: boolean): Promise<void> {
    const context = this.context
    if (!context) return
    await this.queueLifecycle(() => this.loadController(context, reconnect))
  }

  async sendPrompt(
    workerId: string,
    message: string,
    mode: 'prompt' | 'steer' | 'followUp' = 'prompt',
  ): Promise<void> {
    await this.requireController().sendPrompt(workerId, message, mode)
  }

  async getLastAssistantText(workerId: string): Promise<string | null> {
    return (await this.controller?.getLastAssistantText(workerId)) ?? null
  }

  getState(): ClawasState | null {
    return this.controller?.getState() ?? null
  }

  async ensureWorkerRunning(workerId: string): Promise<void> {
    await this.requireController().ensureWorkerRunning(workerId)
  }

  getWorkerIds(): string[] {
    return this.controller?.getWorkerIds() ?? []
  }
  getWorkerDefinition(workerId: string): WorkerDefinition {
    return this.requireController().getWorkerDefinition(workerId)
  }

  getActiveMonitorWorker(): WorkerState | undefined {
    return getActiveMonitorWorker(this.controller?.getState(), this.monitorState)
  }
  getMonitorWorkerBySlot(slot: number): WorkerState | undefined {
    return getMonitorWorkerBySlot(this.controller?.getState(), slot)
  }
  findMonitorWorker(target: string): WorkerState | undefined {
    return findMonitorWorker(this.controller?.getState(), target)
  }
  selectMonitorWorker(workerId: string): void {
    this.monitorState = selectMonitorWorker(
      this.controller?.getState(),
      this.monitorState,
      workerId,
    )
    this.render()
  }
  selectRelativeMonitorWorker(direction: number): void {
    this.monitorState = selectRelativeMonitorWorker(
      this.controller?.getState(),
      this.monitorState,
      direction,
    )
    this.render()
  }
  toggleMonitorFold(): void {
    this.monitorState = { ...this.monitorState, folded: !this.monitorState.folded }
    this.render()
  }

  async openWorkerTab(workerId: string): Promise<void> {
    await this.requireController().focusWorker(workerId)
  }
  canOpenTab(): boolean {
    return this.launcher.canOpenTab()
  }

  async dispose(): Promise<void> {
    const context = this.context
    this.context = null
    // Invalidate workers immediately, even when autostart is awaiting resident sharing.
    const disconnect = this.disconnectController()
    await this.queueLifecycle(async () => {
      if (this.interval) clearInterval(this.interval)
      this.interval = null
      await disconnect
      if (context?.hasUI) this.ui.clear(context)
    })
  }

  private queueLifecycle(operation: () => Promise<void>): Promise<void> {
    const queued = this.lifecycle.catch(() => {}).then(operation)
    this.lifecycle = queued
    return queued
  }

  private async loadController(context: ExtensionContext, reconnect: boolean): Promise<void> {
    if (this.context !== context) return
    const prepareResidentContext: PrepareResidentContext = (workerId) =>
      this.prepareResidentContext(context, workerId)
    try {
      this.clawaDefaults = resolveClawaDefaults(context.cwd)
      const config = await loadClawasConfig(context.cwd)
      const fingerprint = JSON.stringify([context.cwd, config, this.clawaDefaults])
      if (!reconnect && this.controller && this.configFingerprint === fingerprint) return
      await this.disconnectController()
      if (!config) {
        if (context.hasUI) this.ui.clear(context)
        return
      }
      await this.launcher.captureCurrentHost(context.modelRegistry)
      if (this.context !== context) return
      const controller = new ClawasController(
        context.cwd,
        config,
        this.launcher,
        this.clawaDefaults,
        () => this.render(),
        prepareResidentContext,
      )
      this.controller = controller
      try {
        await controller.start()
      } catch (error) {
        await this.disconnectController()
        throw error
      }
      if (this.context !== context) return
      this.configFingerprint = fingerprint
      this.startRepaint()
      this.render()
      this.notifyConnected(context, controller.getState())
    } catch (error) {
      if (context.hasUI) {
        context.ui.notify(
          `Clawas could not connect: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
      }
      throw error
    }
  }

  private notifyConnected(context: ExtensionContext, state: ClawasState): void {
    if (!context.hasUI) return
    context.ui.notify(
      `${this.clawaDefaults.clawasName} loaded ${state.workers.length} Clawas from ${getClawasConfigPath(context.cwd)}.`,
      'info',
    )
    for (const worker of state.workers) {
      if (worker.lastError)
        context.ui.notify(`${worker.definition.title}: ${worker.lastError}`, 'error')
    }
  }

  private async disconnectController(): Promise<void> {
    const previous = this.controller
    this.controller = null
    this.configFingerprint = null
    await previous?.dispose()
  }

  private startRepaint(): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      if (
        this.controller
          ?.getState()
          .workers.some((worker) => worker.status === 'starting' || worker.status === 'streaming')
      ) {
        this.render()
      }
    }, CLAWAS_SPINNER_TICK_MS)
    this.interval.unref?.()
  }

  private render(): void {
    if (!(this.context?.hasUI && this.controller)) return
    this.ui.showMonitor(
      this.context,
      () => this.controller?.getState(),
      () => this.monitorState,
      this.clawaDefaults,
    )
  }

  private requireController(): ClawasController {
    if (!this.controller) throw new Error(`${this.clawaDefaults.clawasName} is not connected`)
    return this.controller
  }
}
