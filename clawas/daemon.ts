import { join } from 'node:path'
import type { ClawaDefaults } from '../config'
import { sendClawasSessionMessage } from './comms/client.js'
import { sendWorkerPrompt } from './daemon-prompt.js'
import { discoverProjectExtensionPaths, resolveWorkerExtensionPaths } from './extension-paths.js'
import { ClawasRpcWorker } from './rpc-worker.js'
import { resolveWorkerSessionFile } from './session-registry.js'
import { createInitialState, getWorkerState, patchWorkerState, pushEvent } from './state.js'
import { summarizeAssistantText, summarizeError, summarizePrompt } from './summaries.js'
import type { ClawasConfig, ClawasState, WorkerDefinition } from './types.js'
import { ClawasWorkerEventRouter } from './worker-event-router.js'
import { getWorkerSessionName, getWorkerSocketAlias } from './worker-identity.js'

function now(): number {
  return Date.now()
}

function resetStateForRestart(state: ClawasState, timestamp: number): void {
  state.events = []
  state.nextEventId = 1

  for (const worker of state.workers) {
    worker.status = 'stopped'
    worker.manualSession = undefined
    worker.pid = undefined
    worker.currentTask = undefined
    worker.currentToolName = undefined
    worker.lastError = undefined
    worker.lastSummary = 'restarting daemon'
    worker.updatedAt = timestamp
  }
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
  private started = false
  private stopping = false

  constructor(
    projectRoot: string,
    private readonly config: ClawasConfig,
    private readonly onStateChange: () => void,
    private readonly clawaDefaults?: ClawaDefaults,
  ) {
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
      if (!definition.autostart) {
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
    // Detached/manual means Clawas deliberately lets go of orchestration.
    // The worker stays reachable to the human, but not to clawas tools.
    await this.stopWorker(workerId)
    patchWorkerState(
      this.state,
      workerId,
      {
        status: 'stopped',
        manualSession: true,
        pid: undefined,
        currentTask: label,
        currentToolName: undefined,
        lastError: undefined,
        lastSummary: label,
      },
      now(),
    )
    pushEvent(this.state, workerId, `${workerId} opened as ${label}`, now())
    this.notifyChanged()
  }

  clearManualSession(workerId: string, label = 'manual session closed'): void {
    patchWorkerState(
      this.state,
      workerId,
      {
        status: 'stopped',
        manualSession: false,
        pid: undefined,
        currentTask: undefined,
        currentToolName: undefined,
        lastError: undefined,
        lastSummary: label,
      },
      now(),
    )
    pushEvent(this.state, workerId, `${workerId} ${label}`, now())
    this.notifyChanged()
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

  private async startWorker(workerId: string): Promise<void> {
    if (this.workers.has(workerId)) {
      return
    }

    const workerState = getWorkerState(this.state, workerId)
    const definition = workerState.definition
    const sessionFile = await resolveWorkerSessionFile(
      this.controlPlaneRoot,
      definition,
      workerState.cwd,
    )
    const worker = this.createWorker(workerState.cwd, definition, sessionFile)

    this.workers.set(workerId, worker)
    this.streamBuffers.set(workerId, '')
    this.attachWorkerListeners(workerId, worker)

    patchWorkerState(
      this.state,
      workerId,
      {
        status: 'starting',
        manualSession: false,
        sessionFile,
        currentTask: definition.startupPrompt
          ? summarizePrompt(definition.startupPrompt)
          : undefined,
      },
      now(),
    )
    pushEvent(this.state, workerId, `${definition.title} starting in ${workerState.cwd}`, now())
    this.notifyChanged()

    try {
      await worker.start()
      await worker.setSessionName(getWorkerSessionName(definition, this.clawaDefaults))
      await this.markWorkerReady(workerId, worker, workerState.lastSummary)

      if (definition.startupPrompt) {
        await this.sendStartupPrompt(workerId, definition)
      }
    } catch (error) {
      await this.handleWorkerStartFailure(workerId, worker, definition, error)
    }
  }

  private async sendStartupPrompt(workerId: string, definition: WorkerDefinition): Promise<void> {
    const message = definition.startupPrompt
    if (!message) {
      return
    }

    try {
      // Startup primes worker context only. It must not trigger a model turn or
      // generate launch/reload status chatter unless a later real task asks for it.
      await sendClawasSessionMessage(getWorkerSocketAlias(definition), {
        message,
        messageType: 'session',
        mode: 'steer',
        sender: {
          workerId: 'main-claw',
          workerTitle: this.getMainClawName(),
        },
        kind: 'instruction',
        intent: 'for_context',
        visibility: 'worker',
      })
    } catch {
      await this.sendPrompt(workerId, message, 'prompt')
    }
  }

  private createWorker(
    cwd: string,
    definition: WorkerDefinition,
    sessionFile?: string,
  ): ClawasRpcWorker {
    return new ClawasRpcWorker({
      definition,
      cwd,
      extensionPaths: this.getWorkerExtensionPaths(definition.id),
      // Report to the stable main-claw alias, not the session id captured when
      // the daemon first started. Main Pi sessions can switch/compact/reload while
      // workers keep running; a frozen session id strands later worker reports in
      // an old transcript.
      reportSessionId: 'main-claw',
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
    const lastAssistantText = await worker.getLastAssistantText()
    const workerState = await worker.getState()
    patchWorkerState(
      this.state,
      workerId,
      {
        status: 'idle',
        manualSession: false,
        pid: worker.pid,
        sessionFile: workerState.sessionFile,
        lastSummary: lastAssistantText
          ? summarizeAssistantText(lastAssistantText)
          : fallbackSummary,
        lastError: undefined,
      },
      now(),
    )
    pushEvent(this.state, workerId, `${worker.definition.title} ready`, now())
    this.notifyChanged()
  }

  private async handleWorkerStartFailure(
    workerId: string,
    worker: ClawasRpcWorker,
    definition: WorkerDefinition,
    error: unknown,
  ): Promise<void> {
    try {
      await worker.stop()
    } catch {
      // Ignore cleanup errors after a failed start.
    }

    this.workers.delete(workerId)
    this.streamBuffers.delete(workerId)
    patchWorkerState(
      this.state,
      workerId,
      {
        status: 'error',
        manualSession: false,
        lastError: summarizeError(error instanceof Error ? error.message : String(error)),
        currentTask: undefined,
      },
      now(),
    )
    pushEvent(
      this.state,
      workerId,
      `${definition.title} failed to start: ${error instanceof Error ? error.message : String(error)}`,
      now(),
    )
    this.notifyChanged()
  }

  private async stopAll(): Promise<void> {
    // Shutdown should be best-effort across the whole clawas. One unhappy worker
    // should not prevent the rest from being torn down cleanly.
    this.stopping = true
    try {
      const runningWorkers = [...this.workers.values()]
      const results = await Promise.allSettled(
        runningWorkers.map(async (worker) => await worker.stop()),
      )
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          continue
        }
        const worker = runningWorkers[index]
        pushEvent(
          this.state,
          worker?.definition.id ?? this.getClawasId(),
          `shutdown warning: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          now(),
        )
      }
    } finally {
      this.workers.clear()
      this.streamBuffers.clear()
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
    this.workers.delete(workerId)
    this.eventRouter.handleClose(workerId, code, signal, stderr, this.stopping || intentional)
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
