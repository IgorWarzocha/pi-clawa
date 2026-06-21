import type { ClawasRpcWorker } from './rpc-worker.js'
import { getWorkerState, patchWorkerState, pushEvent } from './state.js'
import { summarizeError, summarizePrompt } from './summaries.js'
import type { ClawasState } from './types.js'

type PromptMode = 'prompt' | 'steer' | 'followUp'

function resolveEffectivePromptMode(options: {
  requested: PromptMode
  workerIsActive: boolean
}): PromptMode {
  if (options.workerIsActive && options.requested === 'prompt') {
    return 'followUp'
  }

  if (!options.workerIsActive && options.requested !== 'prompt') {
    return 'prompt'
  }

  return options.requested
}

export async function sendWorkerPrompt(options: {
  state: ClawasState
  workers: Map<string, ClawasRpcWorker>
  workerId: string
  message: string
  mode: PromptMode
  getNow: () => number
  getClawasName: () => string
  ensureStarted: (workerId: string) => Promise<void>
  notifyChanged: () => void
}): Promise<void> {
  const workerState = getWorkerState(options.state, options.workerId)
  if (workerState.manualSession) {
    throw new Error(
      `Worker ${options.workerId} is in a manual session and is disconnected from ${options.getClawasName()}`,
    )
  }

  let worker = options.workers.get(options.workerId)
  if (!worker) {
    await options.ensureStarted(options.workerId)
    worker = options.workers.get(options.workerId)
  }
  if (!worker) {
    throw new Error(`Worker ${options.workerId} is not running`)
  }

  const previousStatus = workerState.status
  const previousTask = workerState.currentTask
  const workerIsActive = workerState.status === 'starting' || workerState.status === 'streaming'
  const effectiveMode = resolveEffectivePromptMode({ requested: options.mode, workerIsActive })
  const promptSummary = summarizePrompt(options.message)
  const nextStatus = effectiveMode === 'prompt' ? 'starting' : workerState.status

  patchWorkerState(
    options.state,
    options.workerId,
    { status: nextStatus, currentTask: promptSummary, lastError: undefined },
    options.getNow(),
  )
  pushEvent(
    options.state,
    options.workerId,
    `${options.workerId} queued ${effectiveMode}: ${promptSummary}`,
    options.getNow(),
  )
  options.notifyChanged()

  try {
    if (effectiveMode === 'prompt') {
      await worker.prompt(options.message)
      return
    }
    if (effectiveMode === 'steer') {
      await worker.steer(options.message)
      return
    }
    await worker.followUp(options.message)
  } catch (error) {
    patchWorkerState(
      options.state,
      options.workerId,
      {
        status: previousStatus,
        currentTask: previousTask,
        lastError: summarizeError(error instanceof Error ? error.message : String(error)),
      },
      options.getNow(),
    )
    pushEvent(
      options.state,
      options.workerId,
      `${options.workerId} failed to queue ${effectiveMode}: ${error instanceof Error ? error.message : String(error)}`,
      options.getNow(),
    )
    options.notifyChanged()
    throw error
  }
}
