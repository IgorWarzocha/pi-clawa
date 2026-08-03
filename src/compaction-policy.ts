import type { ContextUsage, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawaCompactionConfig } from './config.js'

export type CompactionPolicyState = {
  invalidatePending: () => void
  hasPending: () => boolean
  isArmed: () => boolean
  disarm: () => void
  rearm: () => void
  beginPending: () => symbol
  settleIfOwned: (token: symbol, outcome: 'succeeded' | 'failed') => boolean
  waitUntilReady: () => Promise<boolean>
}

export function createCompactionPolicyState(): CompactionPolicyState {
  let pendingToken: symbol | null = null
  let pendingPromise = Promise.resolve(true)
  let resolvePending: ((ready: boolean) => void) | null = null
  let armed = true

  const clearPending = (ready: boolean) => {
    pendingToken = null
    resolvePending?.(ready)
    resolvePending = null
    pendingPromise = Promise.resolve(ready)
  }

  return {
    invalidatePending: () => {
      armed = true
      clearPending(pendingToken === null)
    },
    hasPending: () => pendingToken !== null,
    isArmed: () => armed,
    disarm: () => {
      armed = false
    },
    rearm: () => {
      armed = true
    },
    beginPending: () => {
      clearPending(false)
      const token = Symbol('clawa-auto-compaction')
      pendingToken = token
      pendingPromise = new Promise<boolean>((resolve) => {
        resolvePending = resolve
      })
      return token
    },
    settleIfOwned: (token, outcome) => {
      if (pendingToken !== token) return false
      if (outcome === 'succeeded') armed = false
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
  armed = true,
): boolean {
  if (
    !(config.auto && armed) ||
    hasPendingOperation ||
    usage?.tokens === null ||
    usage === undefined
  ) {
    return false
  }
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return false

  const triggerTokens = Math.floor((usage.contextWindow * config.triggerPercent) / 100)
  return usage.tokens >= triggerTokens
}

export function isUsageBelowCompactionThreshold(
  config: ClawaCompactionConfig,
  usage: ContextUsage | undefined,
): boolean {
  if (usage?.tokens === null || usage === undefined) return false
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return false
  return usage.tokens < Math.floor((usage.contextWindow * config.triggerPercent) / 100)
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
  pi.on('session_compact', () => state.disarm())

  pi.on('agent_settled', async (_event, ctx) => {
    const usage = ctx.getContextUsage()
    const config = getCompactionConfig()
    if (isUsageBelowCompactionThreshold(config, usage)) state.rearm()
    if (!shouldRequestAutoCompaction(config, usage, state.hasPending(), state.isArmed())) return

    const token = state.beginPending()
    const notifier = captureNotifier(ctx)
    try {
      ctx.compact({
        onComplete: () => {
          state.settleIfOwned(token, 'succeeded')
        },
        onError: (error) => {
          if (!state.settleIfOwned(token, 'failed')) return
          notifier?.notifyError(error.message)
        },
      })
      await state.waitUntilReady()
    } catch (error) {
      if (!state.settleIfOwned(token, 'failed')) return
      notifier?.notifyError(error instanceof Error ? error.message : String(error))
    }
  })

  return state
}
