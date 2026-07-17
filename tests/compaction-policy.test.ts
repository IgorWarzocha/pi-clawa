import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CompactOptions,
  ContextUsage,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import {
  AUTO_COMPACTION_CONTINUATION_TYPE,
  createCompactionPolicyState,
  registerCompactionPolicy,
  shouldRequestAutoCompaction,
} from '../src/compaction-policy.js'
import { DEFAULT_CLAWA_COMPACTION_CONFIG } from '../src/config.js'

function usage(tokens: number | null): ContextUsage {
  return { tokens, contextWindow: 372_000, percent: tokens === null ? null : 10 }
}

test('shouldRequestAutoCompaction is false without trigger', () => {
  assert.equal(
    shouldRequestAutoCompaction(DEFAULT_CLAWA_COMPACTION_CONFIG, usage(200_000), false),
    false,
  )
})

test('shouldRequestAutoCompaction respects below, exact, and above threshold', () => {
  const config = { summaryMaxTokens: 20_000, triggerTokens: 130_000 }

  assert.equal(shouldRequestAutoCompaction(config, usage(129_999), false), false)
  assert.equal(shouldRequestAutoCompaction(config, usage(130_000), false), true)
  assert.equal(shouldRequestAutoCompaction(config, usage(130_001), false), true)
})

test('shouldRequestAutoCompaction ignores unknown or null usage tokens', () => {
  const config = { summaryMaxTokens: 20_000, triggerTokens: 130_000 }

  assert.equal(shouldRequestAutoCompaction(config, undefined, false), false)
  assert.equal(shouldRequestAutoCompaction(config, usage(null), false), false)
})

test('shouldRequestAutoCompaction blocks while an owned operation is pending', () => {
  const config = { summaryMaxTokens: 20_000, triggerTokens: 130_000 }
  assert.equal(shouldRequestAutoCompaction(config, usage(200_000), true), false)
})

test('compaction policy state invalidates on session_start and blocks stale callbacks', () => {
  const state = createCompactionPolicyState()
  const first = state.beginPending()
  state.invalidatePending()
  assert.equal(state.clearIfOwned(first), false)
  assert.equal(state.hasPending(), false)
})

test('compaction policy state clears only the owning token', () => {
  const state = createCompactionPolicyState()
  const first = state.beginPending()
  const second = state.beginPending()
  assert.equal(state.clearIfOwned(first), false)
  assert.equal(state.clearIfOwned(second), true)
  assert.equal(state.hasPending(), false)
})

test('continuation cooldown arms, consumes once, and clears on invalidate', () => {
  const state = createCompactionPolicyState()
  assert.equal(state.consumeContinuationCooldown(), false)
  state.armContinuationCooldown()
  assert.equal(state.consumeContinuationCooldown(), true)
  assert.equal(state.consumeContinuationCooldown(), false)
  state.armContinuationCooldown()
  state.invalidatePending()
  assert.equal(state.consumeContinuationCooldown(), false)
})

type CapturedHandler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>

type CapturedSendMessage = {
  message: {
    customType: string
    content: string
    display?: boolean
  }
  options?: {
    triggerTurn?: boolean
    deliverAs?: 'steer' | 'followUp' | 'nextTurn'
  }
}

function createCapturePi(): {
  pi: ExtensionAPI
  handlers: Map<string, CapturedHandler[]>
  sendMessages: CapturedSendMessage[]
} {
  const handlers = new Map<string, CapturedHandler[]>()
  const sendMessages: CapturedSendMessage[] = []
  const pi = {
    on: (event: string, handler: CapturedHandler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    sendMessage: (
      message: CapturedSendMessage['message'],
      options?: CapturedSendMessage['options'],
    ) => {
      sendMessages.push(options === undefined ? { message } : { message, options })
    },
  } as unknown as ExtensionAPI
  return { pi, handlers, sendMessages }
}

type CapturedNotification = { message: string; severity?: string | undefined }

function createPolicyCtx(options: {
  tokens?: number | null
  hasUI?: boolean
  notifications?: CapturedNotification[]
  compactCalls?: CompactOptions[]
}): ExtensionContext {
  const notifications: CapturedNotification[] = options.notifications ?? []
  const compactCalls = options.compactCalls ?? []
  return {
    hasUI: options.hasUI ?? true,
    getContextUsage: () => (options.tokens === undefined ? undefined : usage(options.tokens)),
    compact: (opts?: CompactOptions) => {
      compactCalls.push(opts ?? {})
    },
    ui: {
      notify: (message: string, severity?: string) => {
        notifications.push({ message, severity })
      },
    },
  } as unknown as ExtensionContext
}

const RESULT = {
  summary: 'test',
  firstKeptEntryId: 'entry-1',
  tokensBefore: 100,
}

test('registerCompactionPolicy triggers compact at agent_settled threshold', async () => {
  const { pi, handlers } = createCapturePi()
  const config = { summaryMaxTokens: 20_000, triggerTokens: 130_000 }
  registerCompactionPolicy(pi, () => config)

  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 130_000, compactCalls })
  const settled = handlers.get('agent_settled')?.[0]
  assert.ok(settled)
  await settled({}, ctx)

  assert.equal(compactCalls.length, 1)
})

test('registerCompactionPolicy does not duplicate compact while pending', async () => {
  const { pi, handlers } = createCapturePi()
  const config = { summaryMaxTokens: 20_000, triggerTokens: 130_000 }
  registerCompactionPolicy(pi, () => config)

  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, compactCalls })
  const settled = handlers.get('agent_settled')?.[0]
  assert.ok(settled)

  await settled({}, ctx)
  await settled({}, ctx)
  assert.equal(compactCalls.length, 1)
})

test('registerCompactionPolicy owned onComplete clears pending, continues, and cools down one settle', async () => {
  const { pi, handlers, sendMessages } = createCapturePi()
  const state = registerCompactionPolicy(pi, () => ({
    summaryMaxTokens: 20_000,
    triggerTokens: 130_000,
  }))

  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, compactCalls })
  const settled = handlers.get('agent_settled')?.[0]
  assert.ok(settled)

  await settled({}, ctx)
  assert.equal(state.hasPending(), true)
  compactCalls[0]?.onComplete?.(RESULT)
  assert.equal(state.hasPending(), false)
  assert.equal(sendMessages.length, 1)
  assert.equal(sendMessages[0]?.message.customType, AUTO_COMPACTION_CONTINUATION_TYPE)
  assert.equal(sendMessages[0]?.message.display, false)
  assert.deepEqual(sendMessages[0]?.options, { triggerTurn: true, deliverAs: 'followUp' })

  await settled({}, ctx)
  assert.equal(compactCalls.length, 1)

  await settled({}, ctx)
  assert.equal(compactCalls.length, 2)
})

test('registerCompactionPolicy owned onError notifies and does not continue', async () => {
  const { pi, handlers, sendMessages } = createCapturePi()
  registerCompactionPolicy(pi, () => ({ summaryMaxTokens: 20_000, triggerTokens: 130_000 }))

  const notifications: CapturedNotification[] = []
  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, notifications, compactCalls, hasUI: true })
  const settled = handlers.get('agent_settled')?.[0]
  assert.ok(settled)

  await settled({}, ctx)
  compactCalls[0]?.onError?.(new Error('boom'))
  assert.deepEqual(notifications, [
    { message: 'Clawa automatic compaction failed: boom', severity: 'error' },
  ])
  assert.equal(sendMessages.length, 0)
})

test('registerCompactionPolicy owned onError does not notify without UI', async () => {
  const { pi, handlers, sendMessages } = createCapturePi()
  registerCompactionPolicy(pi, () => ({ summaryMaxTokens: 20_000, triggerTokens: 130_000 }))

  const notifications: CapturedNotification[] = []
  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, notifications, compactCalls, hasUI: false })
  const settled = handlers.get('agent_settled')?.[0]
  assert.ok(settled)

  await settled({}, ctx)
  compactCalls[0]?.onError?.(new Error('boom'))
  assert.deepEqual(notifications, [])
  assert.equal(sendMessages.length, 0)
})

test('registerCompactionPolicy session_shutdown invalidation prevents stale callback clear/notify/continue', async () => {
  const { pi, handlers, sendMessages } = createCapturePi()
  const state = registerCompactionPolicy(pi, () => ({
    summaryMaxTokens: 20_000,
    triggerTokens: 130_000,
  }))

  const notifications: CapturedNotification[] = []
  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, notifications, compactCalls })
  const settled = handlers.get('agent_settled')?.[0]
  const sessionShutdown = handlers.get('session_shutdown')?.[0]
  assert.ok(settled)
  assert.ok(sessionShutdown)

  await settled({}, ctx)
  const staleCallbacks = compactCalls[0]
  await sessionShutdown({}, ctx)
  await settled({}, ctx)

  staleCallbacks?.onError?.(new Error('stale'))
  staleCallbacks?.onComplete?.(RESULT)
  assert.equal(state.hasPending(), true)
  assert.deepEqual(notifications, [])
  assert.equal(sendMessages.length, 0)
})

test('registerCompactionPolicy stale instance teardown does not throw, notify, or continue after shutdown', async () => {
  const oldPi = createCapturePi()
  const oldState = registerCompactionPolicy(oldPi.pi, () => ({
    summaryMaxTokens: 20_000,
    triggerTokens: 130_000,
  }))

  const oldNotifications: CapturedNotification[] = []
  const oldCompactCalls: CompactOptions[] = []
  const oldCtx = createPolicyCtx({
    tokens: 200_000,
    notifications: oldNotifications,
    compactCalls: oldCompactCalls,
  })
  const oldSettled = oldPi.handlers.get('agent_settled')?.[0]
  const oldShutdown = oldPi.handlers.get('session_shutdown')?.[0]
  assert.ok(oldSettled)
  assert.ok(oldShutdown)

  await oldSettled({}, oldCtx)
  const staleCallbacks = oldCompactCalls[0]
  assert.ok(staleCallbacks)

  Object.defineProperty(oldCtx, 'hasUI', {
    configurable: true,
    get() {
      throw new Error('stale ctx.hasUI')
    },
  })
  Object.defineProperty(oldCtx, 'ui', {
    configurable: true,
    get() {
      throw new Error('stale ctx.ui')
    },
  })

  await oldShutdown({}, oldCtx)

  assert.doesNotThrow(() => {
    staleCallbacks.onError?.(new Error('late failure'))
    staleCallbacks.onComplete?.(RESULT)
  })
  assert.deepEqual(oldNotifications, [])
  assert.equal(oldState.hasPending(), false)
  assert.equal(oldPi.sendMessages.length, 0)

  const newPi = createCapturePi()
  const newState = registerCompactionPolicy(newPi.pi, () => ({
    summaryMaxTokens: 20_000,
    triggerTokens: 130_000,
  }))
  const newCompactCalls: CompactOptions[] = []
  const newCtx = createPolicyCtx({ tokens: 200_000, compactCalls: newCompactCalls })
  const newSettled = newPi.handlers.get('agent_settled')?.[0]
  assert.ok(newSettled)

  await newSettled({}, newCtx)
  assert.equal(newCompactCalls.length, 1)
  assert.equal(newState.hasPending(), true)
  newCompactCalls[0]?.onComplete?.({
    summary: 'fresh',
    firstKeptEntryId: 'entry-2',
    tokensBefore: 200,
  })
  assert.equal(newState.hasPending(), false)
  assert.equal(newPi.sendMessages.length, 1)
})

test('registerCompactionPolicy session_start invalidation prevents stale callback clear/notify/continue', async () => {
  const { pi, handlers, sendMessages } = createCapturePi()
  const state = registerCompactionPolicy(pi, () => ({
    summaryMaxTokens: 20_000,
    triggerTokens: 130_000,
  }))

  const notifications: CapturedNotification[] = []
  const compactCalls: CompactOptions[] = []
  const ctx = createPolicyCtx({ tokens: 200_000, notifications, compactCalls })
  const settled = handlers.get('agent_settled')?.[0]
  const sessionStart = handlers.get('session_start')?.[0]
  assert.ok(settled)
  assert.ok(sessionStart)

  await settled({}, ctx)
  const staleCallbacks = compactCalls[0]
  await sessionStart({}, ctx)
  await settled({}, ctx)

  staleCallbacks?.onError?.(new Error('stale'))
  staleCallbacks?.onComplete?.(RESULT)
  assert.equal(state.hasPending(), true)
  assert.deepEqual(notifications, [])
  assert.equal(sendMessages.length, 0)
})
