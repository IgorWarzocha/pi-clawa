import type { ContextUsage, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawaCompactionConfig } from './config.js'

export const AUTO_COMPACTION_CONTINUATION_TYPE = 'clawa-auto-compaction-continuation'

const AUTO_COMPACTION_CONTINUATION_CONTENT =
  'Clawa auto-compaction finished. Continue outstanding work from the latest compaction/continuity summary without waiting for a pulse.'

export type CompactionPolicyState = {
  invalidatePending: () => void
  hasPending: () => boolean
  beginPending: () => symbol
  clearIfOwned: (token: symbol) => boolean
  armContinuationCooldown: () => void
  consumeContinuationCooldown: () => boolean
}

export function createCompactionPolicyState(): CompactionPolicyState {
  let pendingToken: symbol | null = null
  let continuationCooldown = false

  return {
    invalidatePending: () => {
      pendingToken = null
      continuationCooldown = false
    },
    hasPending: () => pendingToken !== null,
    beginPending: () => {
      const token = Symbol('clawa-auto-compaction')
      pendingToken = token
      return token
    },
    clearIfOwned: (token) => {
      if (pendingToken !== token) return false
      pendingToken = null
      return true
    },
    armContinuationCooldown: () => {
      continuationCooldown = true
    },
    consumeContinuationCooldown: () => {
      if (!continuationCooldown) return false
      continuationCooldown = false
      return true
    },
  }
}

export function shouldRequestAutoCompaction(
  config: ClawaCompactionConfig,
  usage: ContextUsage | undefined,
  hasPendingOperation: boolean,
): boolean {
  if (config.triggerTokens === undefined || hasPendingOperation) return false
  const tokens = usage?.tokens
  if (tokens === null || tokens === undefined) return false
  return tokens >= config.triggerTokens
}

type AutoCompactionNotifier = {
  notifyError: (message: string) => void
}

function captureAutoCompactionNotifier(ctx: ExtensionContext): AutoCompactionNotifier | undefined {
  if (!ctx.hasUI) return undefined
  const notify = ctx.ui.notify.bind(ctx.ui)
  return {
    notifyError: (message: string) => {
      notify(`Clawa automatic compaction failed: ${message}`, 'error')
    },
  }
}

type ContinuationSender = {
  sendContinuation: () => void
}

function captureContinuationSender(pi: ExtensionAPI): ContinuationSender {
  const sendMessage = pi.sendMessage.bind(pi)
  return {
    sendContinuation: () => {
      sendMessage(
        {
          customType: AUTO_COMPACTION_CONTINUATION_TYPE,
          content: AUTO_COMPACTION_CONTINUATION_CONTENT,
          display: false,
        },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    },
  }
}

function requestCompaction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  token: symbol,
  state: CompactionPolicyState,
): void {
  const notifier = captureAutoCompactionNotifier(ctx)
  const continuation = captureContinuationSender(pi)

  ctx.compact({
    onComplete: () => {
      if (!state.clearIfOwned(token)) return
      state.armContinuationCooldown()
      continuation.sendContinuation()
    },
    onError: (error) => {
      if (!state.clearIfOwned(token)) return
      notifier?.notifyError(error.message)
    },
  })
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
    if (state.consumeContinuationCooldown()) return

    const config = getCompactionConfig()
    const usage = ctx.getContextUsage()
    if (!shouldRequestAutoCompaction(config, usage, state.hasPending())) return

    const token = state.beginPending()
    requestCompaction(pi, ctx, token, state)
  })

  return state
}
