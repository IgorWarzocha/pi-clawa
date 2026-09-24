import { type FSWatcher, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ClawaDefaults } from '../config.js'
import { ensureControlDir, getSocketPath } from './comms/paths.js'
import { discoverProjectExtensionPaths, resolveWorkerExtensionPaths } from './extension-paths.js'
import type { ClawasPanelLauncher } from './panel-launcher.js'
import { ClawasPanelWorker } from './panel-worker.js'
import { createInitialState, getWorkerState, pushEvent } from './state.js'
import type { ClawasConfig, ClawasState, WorkerDefinition } from './types.js'

/** Composes configured worker tabs and their monitor. Terminal hosts own their processes. */
export class ClawasController {
  private readonly state: ClawasState
  private readonly workers = new Map<string, ClawasPanelWorker>()
  private readonly onChange: () => void
  private watcher: FSWatcher | undefined

  constructor(
    projectRoot: string,
    config: ClawasConfig,
    launcher: ClawasPanelLauncher,
    clawaDefaults: ClawaDefaults,
    onChange: () => void,
  ) {
    this.onChange = onChange
    this.state = createInitialState(config.workers, projectRoot, Date.now())
    const extensionPaths = discoverProjectExtensionPaths(projectRoot)
    for (const state of this.state.workers) {
      this.workers.set(
        state.definition.id,
        new ClawasPanelWorker({
          state,
          projectRoot,
          clawaDefaults,
          launcher,
          controlPlaneRoot: join(projectRoot, '.pi', clawaDefaults.controlPlaneDir),
          extensionPaths: resolveWorkerExtensionPaths(
            projectRoot,
            extensionPaths,
            state.definition,
          ),
          onChange: (event) => {
            if (event) pushEvent(this.state, state.definition.id, event, Date.now())
            this.onChange()
          },
        }),
      )
    }
  }

  getState(): ClawasState {
    return this.state
  }

  getWorkerDefinition(workerId: string): WorkerDefinition {
    return getWorkerState(this.state, workerId).definition
  }

  getWorkerIds(): string[] {
    return [...this.workers.keys()]
  }

  async start(): Promise<void> {
    await ensureControlDir()
    this.watcher = watch(dirname(getSocketPath('main-claw')), (_event, filename) => {
      if (!(this.state.connected && filename?.endsWith('.alias'))) return
      const workerId = filename.slice(0, -'.alias'.length)
      // Alias replacement is the reconnect signal after worker /new, /resume, or /reload.
      void this.workers
        .get(workerId)
        ?.reconcile()
        .catch(() => {
          // The worker records its own connection failure in the monitor.
        })
    })
    this.watcher.on('error', (error) => {
      this.watcher?.close()
      pushEvent(
        this.state,
        'clawas',
        `Worker discovery failed: ${error.message}. Reconnect Clawas to retry.`,
        Date.now(),
      )
      this.onChange()
    })
    this.state.connected = true
    this.onChange()
    for (const state of this.state.workers) {
      if (!this.state.connected) break
      // A broken worker stays visible in the monitor without disconnecting its neighbours.
      await this.requireWorker(state.definition.id)
        .connect(state.definition.autostart)
        .catch(() => {})
    }
  }

  async ensureWorkerRunning(workerId: string): Promise<void> {
    await this.requireWorker(workerId).connect(true)
  }

  async sendPrompt(
    workerId: string,
    message: string,
    mode: 'prompt' | 'steer' | 'followUp',
  ): Promise<void> {
    await this.requireWorker(workerId).sendPrompt(message, mode)
  }

  async getLastAssistantText(workerId: string): Promise<string | null> {
    return await this.requireWorker(workerId).getLastAssistantText()
  }

  async focusWorker(workerId: string): Promise<void> {
    await this.requireWorker(workerId).focus()
  }

  async dispose(): Promise<void> {
    this.state.connected = false
    this.watcher?.close()
    this.watcher = undefined
    const settled = await Promise.allSettled(
      [...this.workers.values()].map((worker) => worker.dispose()),
    )
    this.onChange()
    const errors = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    )
    if (errors.length > 0) throw new AggregateError(errors, 'Failed to save Clawa session state')
  }

  private requireWorker(workerId: string): ClawasPanelWorker {
    const worker = this.workers.get(workerId)
    if (!worker) throw new Error(`Unknown Clawa: ${workerId}`)
    return worker
  }
}
