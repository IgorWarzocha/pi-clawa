import type { ContextUsage, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawaCompactionConfig } from './config.js'

export type CompactionPolicyState = {
  invalidatePending: () => void
  hasPending: () => boolean
  beginPending: () => symbol
  clearIfOwned: (token: symbol) => boolean
  waitUntilReady: () => Promise<boolean>
}

export function createCompactionPolicyState(): CompactionPolicyState {
  let pendingToken: symbol | null = null
  let pendingPromise = Promise.resolve(true)
  let resolvePending: ((ready: boolean) => void) | null = null

  const clearPending = (ready: boolean) => {
    pendingToken = null
    resolvePending?.(ready)
    resolvePending = null
    pendingPromise = Promise.resolve(ready)
  }

  return {
    invalidatePending: () => clearPending(pendingToken === null),
    hasPending: () => pendingToken !== null,
    beginPending: () => {
      clearPending(false)
      const token = Symbol('clawa-auto-compaction')
      pendingToken = token
      pendingPromise = new Promise<boolean>((resolve) => {
        resolvePending = resolve
      })
      return token
    },
    clearIfOwned: (token) => {
      if (pendingToken !== token) return false
      clearPending(true)
      return true
    },
    waitUntilReady: () => pendingPromise,
  }
}

export function shouldRequestAutoCompaction(
  config: ClawaCompactionConfig,
  usage: ContextUsage | undefined,
  hasPendingOperation: boolean,
): boolean {
  if (!config.auto || hasPendingOperation || usage?.tokens === null || usage === undefined) {
    return false
  }
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return false

  const triggerTokens = Math.floor((usage.contextWindow * config.triggerPercent) / 100)
  return usage.tokens >= triggerTokens
}

type AutoCompactionNotifier = {
  notifyError: (message: string) => void
}

function captureNotifier(ctx: ExtensionContext): AutoCompactionNotifier | undefined {
  if (!ctx.hasUI) return undefined
  const notify = ctx.ui.notify.bind(ctx.ui)
  return {
    notifyError: (message) => {
      notify(`Clawa automatic compaction failed: ${message}`, 'error')
    },
  }
}

export function registerCompactionPolicy(
  pi: ExtensionAPI,
  getCompactionConfig: () => ClawaCompactionConfig,
  state: CompactionPolicyState = createCompactionPolicyState(),
): CompactionPolicyState {
  const invalidatePending = async () => {
    state.invalidatePending()
  }

  pi.on('session_start', invalidatePending)
  pi.on('session_shutdown', invalidatePending)

  pi.on('agent_settled', async (_event, ctx) => {
    const usage = ctx.getContextUsage()
    if (!shouldRequestAutoCompaction(getCompactionConfig(), usage, state.hasPending())) return

    const token = state.beginPending()
    const notifier = captureNotifier(ctx)
    try {
      ctx.compact({
        onComplete: () => {
          state.clearIfOwned(token)
        },
        onError: (error) => {
          if (!state.clearIfOwned(token)) return
          notifier?.notifyError(error.message)
        },
      })
      await state.waitUntilReady()
    } catch (error) {
      if (!state.clearIfOwned(token)) return
      notifier?.notifyError(error instanceof Error ? error.message : String(error))
    }
  })

  return state
}
