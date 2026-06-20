import type { ClawaDefaults } from '../config'
import { sendClawasSessionMessage } from './comms/client.js'
import { ClawasRpcWorker } from './rpc-worker.js'
import { patchWorkerState, pushEvent } from './state.js'
import { summarizeAssistantText, summarizeError } from './summaries.js'
import type { ClawasState, WorkerDefinition } from './types.js'
import { getWorkerSessionName, getWorkerSocketAlias } from './worker-identity.js'

export async function sendStartupContextMessage(options: {
  definition: WorkerDefinition
  message: string
  getMainClawName: () => string
  fallbackPrompt: () => Promise<void>
}): Promise<void> {
  try {
    await sendClawasSessionMessage(getWorkerSocketAlias(options.definition), {
      message: options.message,
      messageType: 'session',
      mode: 'steer',
      sender: {
        workerId: 'main-claw',
        workerTitle: options.getMainClawName(),
      },
      kind: 'instruction',
      intent: 'for_context',
      visibility: 'worker',
    })
  } catch {
    await options.fallbackPrompt()
  }
}

export function createRpcWorker(options: {
  definition: WorkerDefinition
  cwd: string
  extensionPaths: string[]
  sessionFile?: string
}): ClawasRpcWorker {
  return new ClawasRpcWorker({
    definition: options.definition,
    cwd: options.cwd,
    extensionPaths: options.extensionPaths,
    reportSessionId: 'main-claw',
    sessionFile: options.sessionFile,
  })
}

export async function markWorkerReadyState(options: {
  state: ClawasState
  workerId: string
  worker: ClawasRpcWorker
  fallbackSummary: string
  clawaDefaults?: ClawaDefaults
  timestamp: number
}): Promise<void> {
  const lastAssistantText = await options.worker.getLastAssistantText()
  const workerState = await options.worker.getState()
  patchWorkerState(
    options.state,
    options.workerId,
    {
      status: 'idle',
      manualSession: false,
      pid: options.worker.pid,
      sessionFile: workerState.sessionFile,
      lastSummary: lastAssistantText
        ? summarizeAssistantText(lastAssistantText)
        : options.fallbackSummary,
      lastError: undefined,
    },
    options.timestamp,
  )
  pushEvent(
    options.state,
    options.workerId,
    `${options.worker.definition.title} ready`,
    options.timestamp,
  )
}

export async function handleWorkerStartFailureState(options: {
  state: ClawasState
  workers: Map<string, ClawasRpcWorker>
  streamBuffers: Map<string, string>
  workerId: string
  worker: ClawasRpcWorker
  definition: WorkerDefinition
  error: unknown
  timestamp: number
}): Promise<void> {
  try {
    await options.worker.stop()
  } catch {
    // Ignore cleanup errors after a failed start.
  }

  options.workers.delete(options.workerId)
  options.streamBuffers.delete(options.workerId)
  patchWorkerState(
    options.state,
    options.workerId,
    {
      status: 'error',
      manualSession: false,
      lastError: summarizeError(
        options.error instanceof Error ? options.error.message : String(options.error),
      ),
      currentTask: undefined,
    },
    options.timestamp,
  )
  pushEvent(
    options.state,
    options.workerId,
    `${options.definition.title} failed to start: ${options.error instanceof Error ? options.error.message : String(options.error)}`,
    options.timestamp,
  )
}

export async function nameWorkerSession(
  worker: ClawasRpcWorker,
  clawaDefaults?: ClawaDefaults,
): Promise<void> {
  await worker.setSessionName(getWorkerSessionName(worker.definition, clawaDefaults))
}
