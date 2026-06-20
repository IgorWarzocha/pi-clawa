import type { ClawasRpcWorker } from './rpc-worker.js'
import { resolveWorkerSessionFile } from './session-registry.js'
import { getWorkerState, patchWorkerState, pushEvent } from './state.js'
import { summarizePrompt } from './summaries.js'
import type { ClawasState, WorkerDefinition } from './types.js'

export async function startWorkerProcess(options: {
  state: ClawasState
  workers: Map<string, ClawasRpcWorker>
  streamBuffers: Map<string, string>
  controlPlaneRoot: string
  workerId: string
  createWorker: (cwd: string, definition: WorkerDefinition, sessionFile?: string) => ClawasRpcWorker
  attachWorkerListeners: (workerId: string, worker: ClawasRpcWorker) => void
  nameWorkerSession: (worker: ClawasRpcWorker) => Promise<void>
  markWorkerReady: (
    workerId: string,
    worker: ClawasRpcWorker,
    fallbackSummary: string,
  ) => Promise<void>
  sendStartupPrompt: (workerId: string, definition: WorkerDefinition) => Promise<void>
  handleWorkerStartFailure: (
    workerId: string,
    worker: ClawasRpcWorker,
    definition: WorkerDefinition,
    error: unknown,
  ) => Promise<void>
  notifyChanged: () => void
  getNow: () => number
}): Promise<void> {
  if (options.workers.has(options.workerId)) {
    return
  }

  const workerState = getWorkerState(options.state, options.workerId)
  const definition = workerState.definition
  const sessionFile = await resolveWorkerSessionFile(
    options.controlPlaneRoot,
    definition,
    workerState.cwd,
  )
  const worker = options.createWorker(workerState.cwd, definition, sessionFile)

  options.workers.set(options.workerId, worker)
  options.streamBuffers.set(options.workerId, '')
  options.attachWorkerListeners(options.workerId, worker)

  patchWorkerState(
    options.state,
    options.workerId,
    {
      status: 'starting',
      manualSession: false,
      sessionFile,
      currentTask: definition.startupPrompt ? summarizePrompt(definition.startupPrompt) : undefined,
    },
    options.getNow(),
  )
  pushEvent(
    options.state,
    options.workerId,
    `${definition.title} starting in ${workerState.cwd}`,
    options.getNow(),
  )
  options.notifyChanged()

  try {
    await worker.start()
    await options.nameWorkerSession(worker)
    await options.markWorkerReady(options.workerId, worker, workerState.lastSummary)

    if (definition.startupPrompt) {
      await options.sendStartupPrompt(options.workerId, definition)
    }
  } catch (error) {
    await options.handleWorkerStartFailure(options.workerId, worker, definition, error)
  }
}
