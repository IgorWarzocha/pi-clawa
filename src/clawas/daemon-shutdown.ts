import type { ClawasRpcWorker } from './rpc-worker.js'
import { pushEvent } from './state.js'
import type { ClawasState } from './types.js'

export async function stopAllWorkers(options: {
  state: ClawasState
  workers: Map<string, ClawasRpcWorker>
  workerStarts: Map<string, Promise<void>>
  streamBuffers: Map<string, string>
  getNow: () => number
}): Promise<void> {
  const stopWorkers = async (workers: ClawasRpcWorker[]): Promise<void> => {
    await Promise.all(
      workers.map(async (worker) => {
        try {
          await worker.stop()
        } catch (error) {
          pushEvent(
            options.state,
            worker.definition.id,
            `shutdown warning: ${error instanceof Error ? error.message : String(error)}`,
            options.getNow(),
          )
        }
      }),
    )
  }

  // Closing registered workers releases RPCs that their startup paths may be awaiting.
  const registered = new Set(options.workers.values())
  await Promise.all([
    stopWorkers([...registered]),
    Promise.allSettled([...options.workerStarts.values()]),
  ])
  // A start reserved before shutdown may register its child after the first snapshot.
  await stopWorkers([...options.workers.values()].filter((worker) => !registered.has(worker)))

  options.workers.clear()
  options.streamBuffers.clear()
}
