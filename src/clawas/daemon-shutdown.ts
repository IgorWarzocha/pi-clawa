import type { ClawasRpcWorker } from './rpc-worker.js'
import { pushEvent } from './state.js'
import type { ClawasState } from './types.js'

export async function stopAllWorkers(options: {
  state: ClawasState
  workers: Map<string, ClawasRpcWorker>
  streamBuffers: Map<string, string>
  getFallbackId: () => string
  getNow: () => number
}): Promise<void> {
  const runningWorkers = [...options.workers.values()]
  const results = await Promise.allSettled(
    runningWorkers.map(async (worker) => await worker.stop()),
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      continue
    }
    const worker = runningWorkers[index]
    pushEvent(
      options.state,
      worker?.definition.id ?? options.getFallbackId(),
      `shutdown warning: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      options.getNow(),
    )
  }

  options.workers.clear()
  options.streamBuffers.clear()
}
