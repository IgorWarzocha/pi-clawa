import { setTimeout as delay } from 'node:timers/promises'
import type { ClawaDefaults } from '../config.js'
import {
  getClawasLastMessage,
  getClawasSessionStatus,
  sendClawasSessionMessage,
  watchClawasSession,
} from './comms/client.js'
import type { ClawasSessionStatus } from './comms/types.js'
import type { PanelHandle } from './panel-host.js'
import type { ClawasPanelLauncher } from './panel-launcher.js'
import {
  readWorkerSession,
  recordWorkerSession,
  resolveWorkerSessionFile,
} from './session-registry.js'
import type { PrepareResidentContext } from './shared-context.js'
import { summarizeError, summarizePrompt } from './summaries.js'
import type { WorkerState } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

interface PanelWorkerOptions {
  state: WorkerState
  projectRoot: string
  controlPlaneRoot: string
  extensionPaths: string[]
  clawaDefaults: ClawaDefaults
  launcher: Pick<ClawasPanelLauncher, 'open' | 'focus' | 'close' | 'isAlive'>
  onChange: (event?: string) => void
  prepareResidentContext?: PrepareResidentContext | undefined
}

/** Owns a connection to one terminal session, never the session's process lifetime. */
export class ClawasPanelWorker {
  private active = true
  private pending: Promise<void> | undefined
  private subscription: { close(): void } | undefined
  private persistence: Promise<void> = Promise.resolve()
  private readonly options: PanelWorkerOptions

  constructor(options: PanelWorkerOptions) {
    this.options = options
  }

  private get state(): WorkerState {
    return this.options.state
  }
  private get alias(): string {
    return getWorkerSocketAlias(this.state.definition)
  }

  async connect(launch: boolean): Promise<void> {
    if (!this.active) throw new Error(`Clawa ${this.alias} is disconnected from the main session`)
    if (this.pending) {
      await this.pending
      if (launch && !this.subscription && this.active) await this.connect(true)
      return
    }
    if (this.subscription) return
    // Reserve before the first lookup. Autostart, a pulse, and /jump can arrive together.
    const operation = Promise.resolve().then(() => this.connectSession(launch))
    this.pending = operation
    try {
      await operation
    } catch (error) {
      this.fail(error)
      throw error
    } finally {
      if (this.pending === operation) this.pending = undefined
    }
  }

  private async connectSession(launch: boolean): Promise<void> {
    const record = await readWorkerSession(this.options.controlPlaneRoot, this.alias)
    this.state.panel = record?.panel
    const live = await getClawasSessionStatus(this.alias)
    if (!this.active) return
    if (live) {
      this.validateSession(live)
      if (record?.cwd && record.cwd !== this.state.cwd) {
        throw new Error(`Close ${this.alias}'s existing tab before changing its home`)
      }
      await this.subscribe()
      return
    }
    if (!launch) return
    if (record?.panel && (await this.options.launcher.isAlive(record.panel))) {
      throw new Error(
        `${this.alias}'s tab is open but its Clawa connection is unavailable. Check that tab before reopening it.`,
      )
    }
    this.state.panel = undefined
    if (!this.active) return
    await this.launch()
  }

  private async launch(): Promise<void> {
    const { state, controlPlaneRoot, launcher } = this.options
    const { sessionFile, kind } = await resolveWorkerSessionFile(
      controlPlaneRoot,
      state.definition,
      state.cwd,
    )
    if (!this.active) return
    const binding =
      kind === 'fresh' ? await this.options.prepareResidentContext?.(this.alias) : undefined
    if (!this.active) return
    this.update(
      { status: 'starting', sessionFile, lastError: undefined },
      `${state.definition.title} opening`,
    )
    const panel = await launcher.open({
      definition: state.definition,
      cwd: state.cwd,
      projectRoot: this.options.projectRoot,
      extensionPaths: this.options.extensionPaths,
      clawaDefaults: this.options.clawaDefaults,
      sessionFile,
    })
    this.state.panel = panel
    try {
      await this.persistSession(sessionFile, panel)
      const status = await this.waitUntilReady()
      if (this.active && binding) {
        const sharedContext = await binding.accept(status)
        if (this.active) this.update({ sharedContext })
      }
      if (this.active) await this.subscribe()
    } catch (error) {
      // Only this launch's location is disposable. Adoption and main shutdown never close it.
      this.subscription?.close()
      this.subscription = undefined
      this.state.sharedContext = undefined
      try {
        await launcher.close(panel)
        this.state.panel = undefined
        await this.persistSession(sessionFile, undefined)
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to start ${this.alias} and close its new tab: ${String(error)}; ${String(cleanupError)}`,
        )
      }
      throw error
    }
    if (this.active && state.definition.startupPrompt) {
      await sendClawasSessionMessage(this.alias, {
        message: state.definition.startupPrompt,
        sender: { workerId: 'main-claw', workerTitle: this.options.clawaDefaults.mainClawName },
        kind: 'instruction',
        intent: 'for_context',
        visibility: 'worker',
      })
    }
  }

  private async waitUntilReady(): Promise<ClawasSessionStatus> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const status = await getClawasSessionStatus(this.alias)
      if (status) {
        this.validateSession(status)
        return status
      }
      await delay(100)
    }
    throw new Error(`Timed out waiting for ${this.alias}'s tab to load Clawa`)
  }

  private validateSession(status: ClawasSessionStatus): void {
    if (status.workerId !== this.alias || status.cwd !== this.state.cwd) {
      throw new Error(
        `Clawa socket ${this.alias} belongs to another session. Close the old worker before reopening it.`,
      )
    }
  }

  private async subscribe(): Promise<void> {
    const subscription = await watchClawasSession(this.alias, {
      onStatus: (status) => {
        if (this.active) this.applyStatus(status)
      },
      onClose: (error) => {
        if (!this.active) return
        this.subscription = undefined
        this.update(
          {
            status: 'stopped',
            currentTask: undefined,
            currentToolName: undefined,
            lastError: error.message,
          },
          `${this.alias} disconnected`,
        )
        void this.reconcile().catch((failure: unknown) => this.fail(failure))
      },
    })
    if (this.active) this.subscription = subscription
    else subscription.close()
  }

  async reconcile(): Promise<void> {
    await this.pending?.catch(() => {})
    if (this.active && !this.subscription) await this.connect(false)
  }

  private applyStatus(status: ClawasSessionStatus): void {
    this.validateSession(status)
    const nextStatus = status.isIdle
      ? status.hasPendingMessages
        ? 'starting'
        : 'idle'
      : 'streaming'
    const ended =
      (this.state.status === 'streaming' || this.state.status === 'starting') &&
      nextStatus === 'idle'
    const sessionChanged = status.sessionFile && status.sessionFile !== this.state.sessionFile
    this.update(
      {
        status: nextStatus,
        sessionFile: status.sessionFile,
        sharedContext: status.sharedContext,
        currentToolName: status.currentToolName,
        currentTask: ended ? undefined : this.state.currentTask,
        lastSummary:
          status.lastSummary ||
          (this.state.lastSummary === 'not started yet' ? 'ready' : this.state.lastSummary),
        lastError: status.lastError,
      },
      ended && status.lastSummary ? `${this.alias} finished: ${status.lastSummary}` : undefined,
    )
    if (sessionChanged && status.sessionFile) {
      void this.persistSession(status.sessionFile, this.state.panel).catch((error: unknown) =>
        this.fail(error),
      )
    }
  }

  private persistSession(sessionFile: string, panel: PanelHandle | undefined): Promise<void> {
    const { controlPlaneRoot, state } = this.options
    this.persistence = this.persistence
      .catch(() => {})
      .then(() =>
        recordWorkerSession(controlPlaneRoot, state.definition, state.cwd, sessionFile, panel),
      )
    return this.persistence
  }

  async sendPrompt(message: string, mode: 'prompt' | 'steer' | 'followUp'): Promise<void> {
    await this.connect(true)
    if (!this.active) throw new Error('Main Clawa session changed before delivery')
    const summary = summarizePrompt(message)
    try {
      await sendClawasSessionMessage(this.alias, {
        message,
        mode: mode === 'steer' ? 'steer' : 'followUp',
        sender: { workerId: 'main-claw', workerTitle: this.options.clawaDefaults.mainClawName },
        kind: 'instruction',
        intent: 'reply_requested',
        visibility: 'worker',
      })
      this.update(
        { currentTask: summary, lastError: undefined },
        `${this.alias} queued: ${summary}`,
      )
    } catch (error) {
      this.update({ lastError: String(error) })
      throw error
    }
  }

  async focus(): Promise<void> {
    await this.connect(true)
    if (!this.active) throw new Error('Main Clawa session changed before focus')
    const panel = this.state.panel
    if (!panel) throw new Error(`${this.alias} is running without a recorded tab location`)
    await this.options.launcher.focus(panel)
  }

  async getLastAssistantText(): Promise<string | null> {
    return (await getClawasLastMessage(this.alias))?.content ?? null
  }

  async dispose(): Promise<void> {
    this.active = false
    await this.pending?.catch(() => {})
    this.subscription?.close()
    this.subscription = undefined
    await this.persistence
  }

  private update(patch: Partial<Omit<WorkerState, 'definition' | 'cwd'>>, event?: string): void {
    Object.assign(this.state, patch, { updatedAt: Date.now() })
    this.options.onChange(event)
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.update(
      { status: 'error', lastError: summarizeError(message) },
      `${this.alias}: ${message}`,
    )
  }
}
