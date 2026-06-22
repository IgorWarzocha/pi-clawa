import { join } from 'node:path'
import type { ClawaDefaults } from '../config'
import { getClawasSessionStatus } from './comms/client.js'
import { sendWorkerPrompt } from './daemon-prompt.js'
import { stopAllWorkers } from './daemon-shutdown.js'
import { startWorkerProcess } from './daemon-start-worker.js'
import {
  clearManualSessionState,
  markWorkerDetachedState,
  resetStateForRestart,
} from './daemon-state.js'
import {
  createRpcWorker,
  handleWorkerStartFailureState,
  markWorkerReadyState,
  nameWorkerSession,
  sendStartupContextMessage,
} from './daemon-worker-lifecycle.js'
import { discoverProjectExtensionPaths, resolveWorkerExtensionPaths } from './extension-paths.js'
import type { ClawasRpcWorker } from './rpc-worker.js'
import { resolveWorkerSessionFile } from './session-registry.js'
import { createInitialState, getWorkerState } from './state.js'
import type { ClawasConfig, ClawasState, WorkerDefinition } from './types.js'
import { ClawasWorkerEventRouter } from './worker-event-router.js'
import { getWorkerSocketAlias } from './worker-identity.js'

function now(): number {
  return Date.now()
}

/**
 * Orchestrates worker lifecycles and leaves presentation/event details to helper modules.
 */
export class ClawasDaemon {
  private readonly state: ClawasState
  private readonly workers = new Map<string, ClawasRpcWorker>()
  private readonly streamBuffers = new Map<string, string>()
  private readonly intentionalStops = new Set<string>()
  private readonly extensionPaths: string[]
  private readonly projectRoot: string
  private readonly controlPlaneRoot: string
  private readonly eventRouter: ClawasWorkerEventRouter
  private readonly config: ClawasConfig
  private readonly onStateChange: () => void
  private readonly clawaDefaults?: ClawaDefaults | undefined
  private started = false
  private stopping = false

  constructor(
    projectRoot: string,
    config: ClawasConfig,
    onStateChange: () => void,
    clawaDefaults?: ClawaDefaults | undefined,
  ) {
    this.config = config
    this.onStateChange = onStateChange
    this.clawaDefaults = clawaDefaults
    this.projectRoot = projectRoot
    this.state = createInitialState(config.workers, projectRoot, now())
    this.extensionPaths = discoverProjectExtensionPaths(projectRoot)
    this.controlPlaneRoot = join(
      projectRoot,
      '.pi',
      this.clawaDefaults?.controlPlaneDir ?? 'clawas',
    )

    this.eventRouter = new ClawasWorkerEventRouter({
      state: this.state,
      streamBuffers: this.streamBuffers,
      notifyChanged: () => this.notifyChanged(),
      getNow: now,
    })
  }

  getState(): ClawasState {
    return this.state
  }

  getWorkerDefinition(workerId: string): WorkerDefinition {
    return getWorkerState(this.state, workerId).definition
  }

  getWorkerIds(): string[] {
    return this.state.workers.map((worker) => worker.definition.id)
  }

  getWorkerCwd(workerId: string): string {
    return getWorkerState(this.state, workerId).cwd
  }

  async getWorkerSessionFile(workerId: string): Promise<string | undefined> {
    const workerState = getWorkerState(this.state, workerId)
    if (workerState.sessionFile) {
      return workerState.sessionFile
    }

    return await resolveWorkerSessionFile(
      this.controlPlaneRoot,
      workerState.definition,
      workerState.cwd,
    )
  }

  isWorkerManual(workerId: string): boolean {
    return getWorkerState(this.state, workerId).manualSession === true
  }

  getManualWorkerIds(): string[] {
    return this.state.workers
      .filter((worker) => worker.manualSession)
      .map((worker) => worker.definition.id)
  }

  getExtensionPaths(workerId?: string): string[] {
    if (!workerId) {
      return [...this.extensionPaths]
    }

    return this.getWorkerExtensionPaths(workerId)
  }

  getWorkerExtensionPaths(workerId: string): string[] {
    const definition = this.getWorkerDefinition(workerId)
    return resolveWorkerExtensionPaths(this.projectRoot, this.extensionPaths, definition)
  }

  async getLastAssistantText(workerId: string): Promise<string | null> {
    const worker = this.workers.get(workerId)
    if (!worker) {
      return null
    }
    return await worker.getLastAssistantText()
  }

  async start(): Promise<void> {
    if (this.started) {
      return
    }

    this.started = true
    this.state.daemonStarted = true
    this.notifyChanged()

    for (const definition of this.config.workers) {
      await this.adoptLiveManualSession(definition.id)
    }

    for (const definition of this.config.workers) {
      if (!definition.autostart) {
        continue
      }
      if (getWorkerState(this.state, definition.id).manualSession) {
        continue
      }
      await this.startWorker(definition.id)
    }
  }

  async restart(): Promise<void> {
    await this.stopAll()
    this.started = false
    resetStateForRestart(this.state, now())
    await this.start()
  }

  async dispose(): Promise<void> {
    await this.stopAll()
    this.state.daemonStarted = false
    this.notifyChanged()
  }

  async stopWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId)
    if (!worker) {
      return
    }
    this.intentionalStops.add(workerId)
    await worker.stop()
  }

  async ensureWorkerRunning(workerId: string): Promise<void> {
    const workerState = getWorkerState(this.state, workerId)
    // Manual sessions belong to the human until the socket disappears.
    // The daemon must not quietly spin up a second copy behind their back.
    if (workerState.manualSession) {
      throw new Error(
        `Worker ${workerId} is in a manual session and is disconnected from ${this.getClawasName()}`,
      )
    }
    await this.startWorker(workerId)
  }

  async markWorkerDetached(workerId: string, label = 'manual session'): Promise<void> {
    // Detached/manual means Clawas deliberately lets go of orchestration after
    // the managed worker has already been stopped by the takeover path. Do not
    // stop again here: a second abort can leave the slash command waiting on a
    // worker that is already exiting while the manual panel is open.
    markWorkerDetachedState(this.state, workerId, label, now())
    this.notifyChanged()
  }

  clearManualSession(workerId: string, label = 'manual session closed'): void {
    clearManualSessionState(this.state, workerId, label, now())
    this.notifyChanged()

    const definition = this.getWorkerDefinition(workerId)
    if (definition.enabled && definition.autostart) {
      void this.startWorker(workerId)
    }
  }

  async sendPrompt(
    workerId: string,
    message: string,
    mode: 'prompt' | 'steer' | 'followUp' = 'prompt',
  ): Promise<void> {
    await sendWorkerPrompt({
      state: this.state,
      workers: this.workers,
      workerId,
      message,
      mode,
      getNow: now,
      getClawasName: () => this.getClawasName(),
      ensureStarted: async (id) => await this.startWorker(id),
      notifyChanged: () => this.notifyChanged(),
    })
  }

  private async adoptLiveManualSession(workerId: string): Promise<boolean> {
    const definition = this.getWorkerDefinition(workerId)
    const status = await getClawasSessionStatus(getWorkerSocketAlias(definition))
    if (status?.kind !== 'manual') {
      return false
    }

    const workerState = getWorkerState(this.state, workerId)
    const sessionFile =
      workerState.sessionFile ??
      (await resolveWorkerSessionFile(this.controlPlaneRoot, definition, workerState.cwd).catch(
        () => undefined,
      ))
    markWorkerDetachedState(this.state, workerId, 'manual session', now(), sessionFile)
    this.notifyChanged()
    return true
  }

  private async startWorker(workerId: string): Promise<void> {
    await startWorkerProcess({
      state: this.state,
      workers: this.workers,
      streamBuffers: this.streamBuffers,
      controlPlaneRoot: this.controlPlaneRoot,
      workerId,
      createWorker: (cwd, definition, sessionFile) =>
        this.createWorker(cwd, definition, sessionFile),
      attachWorkerListeners: (id, worker) => this.attachWorkerListeners(id, worker),
      nameWorkerSession: async (worker) => await nameWorkerSession(worker, this.clawaDefaults),
      markWorkerReady: async (id, worker, fallbackSummary) =>
        await this.markWorkerReady(id, worker, fallbackSummary),
      sendStartupPrompt: async (id, definition) => await this.sendStartupPrompt(id, definition),
      handleWorkerStartFailure: async (id, worker, definition, error) =>
        await this.handleWorkerStartFailure(id, worker, definition, error),
      notifyChanged: () => this.notifyChanged(),
      getNow: now,
    })
  }

  private async sendStartupPrompt(workerId: string, definition: WorkerDefinition): Promise<void> {
    const message = definition.startupPrompt
    if (!message) {
      return
    }

    await sendStartupContextMessage({
      definition,
      message,
      getMainClawName: () => this.getMainClawName(),
      fallbackPrompt: async () => await this.sendPrompt(workerId, message, 'prompt'),
    })
  }

  private createWorker(
    cwd: string,
    definition: WorkerDefinition,
    sessionFile?: string,
  ): ClawasRpcWorker {
    return createRpcWorker({
      definition,
      cwd,
      extensionPaths: this.getWorkerExtensionPaths(definition.id),
      sessionFile,
    })
  }

  private attachWorkerListeners(workerId: string, worker: ClawasRpcWorker): void {
    worker.onEvent((event) => {
      this.eventRouter.handleEvent(workerId, event)
    })
    worker.onClose((code, signal) => {
      this.handleWorkerClose(workerId, code, signal)
    })
  }

  private async markWorkerReady(
    workerId: string,
    worker: ClawasRpcWorker,
    fallbackSummary: string,
  ): Promise<void> {
    await markWorkerReadyState({
      state: this.state,
      workerId,
      worker,
      fallbackSummary,
      clawaDefaults: this.clawaDefaults,
      timestamp: now(),
    })
    this.notifyChanged()
  }

  private async handleWorkerStartFailure(
    workerId: string,
    worker: ClawasRpcWorker,
    definition: WorkerDefinition,
    error: unknown,
  ): Promise<void> {
    await handleWorkerStartFailureState({
      state: this.state,
      workers: this.workers,
      streamBuffers: this.streamBuffers,
      workerId,
      worker,
      definition,
      error,
      timestamp: now(),
    })
    this.notifyChanged()
  }

  private async stopAll(): Promise<void> {
    // Shutdown should be best-effort across the whole clawas. One unhappy worker
    // should not prevent the rest from being torn down cleanly.
    this.stopping = true
    try {
      await stopAllWorkers({
        state: this.state,
        workers: this.workers,
        streamBuffers: this.streamBuffers,
        getFallbackId: () => this.getClawasId(),
        getNow: now,
      })
    } finally {
      this.stopping = false
      this.notifyChanged()
    }
  }

  private handleWorkerClose(
    workerId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const worker = this.workers.get(workerId)
    const stderr = worker?.getStderr() ?? ''
    const intentional = this.intentionalStops.delete(workerId)
    const definition = getWorkerState(this.state, workerId).definition
    this.workers.delete(workerId)
    this.eventRouter.handleClose(workerId, code, signal, stderr, this.stopping || intentional)

    if (!(this.stopping || intentional) && definition.enabled && definition.autostart) {
      void this.startWorker(workerId)
    }
  }

  private getClawasName(): string {
    return this.clawaDefaults?.clawasName ?? 'Clawas'
  }

  private getMainClawName(): string {
    return this.clawaDefaults?.mainClawName ?? 'Clawa'
  }

  private getClawasId(): string {
    return this.getClawasName()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
  }

  private notifyChanged(): void {
    this.onStateChange()
  }
}
