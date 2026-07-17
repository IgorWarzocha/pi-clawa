import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from '@earendil-works/pi-coding-agent'
import {
  type ContinuityCompletionFn,
  formatContinuitySummaryFailureNotice,
  normalizeUnknownContextOverflowMessage,
  registerContinuityCompaction,
  resolveContinuitySummaryMaxTokens,
} from '../src/continuity-compaction.js'

const CONTINUITY_RESPONSE = `<continuity>
## Where We Are
Test summary.

## What Matters
- One thing

## Open Threads
- None.

## Working Memory
- One detail
</continuity>
<memories>
NONE
</memories>`

type CapturedHandler = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<unknown>

function createCapturePi(): { pi: ExtensionAPI; handlers: Map<string, CapturedHandler[]> } {
  const handlers = new Map<string, CapturedHandler[]>()
  const pi = {
    on: (event: string, registered: CapturedHandler) => {
      const list = handlers.get(event) ?? []
      list.push(registered)
      handlers.set(event, list)
    },
    getThinkingLevel: () => undefined,
  } as unknown as ExtensionAPI
  return { pi, handlers }
}

function createCompactionEvent(reserveTokens = 150_000): SessionBeforeCompactEvent {
  return {
    type: 'session_before_compact',
    preparation: {
      firstKeptEntryId: 'keep-entry-1',
      messagesToSummarize: [
        {
          role: 'user',
          content: 'Compaction test message',
          timestamp: Date.now(),
        },
      ],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 50_000,
      fileOps: {
        read: new Set<string>(),
        written: new Set<string>(),
        edited: new Set<string>(),
      },
      settings: {
        enabled: true,
        reserveTokens,
        keepRecentTokens: 20_000,
      },
    },
    branchEntries: [],
    reason: 'threshold',
    willRetry: false,
    signal: AbortSignal.timeout(30_000),
  }
}

async function createContinuityCtx(cwd: string): Promise<{
  ctx: ExtensionContext
  notifications: Array<{ message: string; severity?: string | undefined }>
}> {
  const notifications: Array<{ message: string; severity?: string | undefined }> = []
  return {
    notifications,
    ctx: {
      cwd,
      hasUI: true,
      model: {
        provider: 'test-provider',
        id: 'test-model',
        maxTokens: 128_000,
      },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'test-key' }),
      },
      ui: {
        notify: (message: string, severity?: string) => {
          notifications.push({ message, severity })
        },
      },
    } as unknown as ExtensionContext,
  }
}

test('normalizes provider context-window markers for Pi overflow recovery', () => {
  const normalized = normalizeUnknownContextOverflowMessage({
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'Unhandled stop reason: model_context_window_exceeded',
  })

  assert.equal(
    normalized?.errorMessage,
    'context_length_exceeded: Unhandled stop reason: model_context_window_exceeded',
  )
})

test('does not rewrite unrelated model errors', () => {
  const normalized = normalizeUnknownContextOverflowMessage({
    role: 'assistant',
    stopReason: 'error',
    errorMessage: 'rate limit exceeded',
  })

  assert.equal(normalized, undefined)
})

test('resolveContinuitySummaryMaxTokens keeps configured cap by default', () => {
  assert.equal(resolveContinuitySummaryMaxTokens(20_000, 128_000), 20_000)
})

test('resolveContinuitySummaryMaxTokens clamps to positive model maxTokens', () => {
  assert.equal(resolveContinuitySummaryMaxTokens(20_000, 8_192), 8_192)
  assert.equal(resolveContinuitySummaryMaxTokens(20_000, 0), 20_000)
})

test('continuity summary failure notice preserves Pi native fallback wording', () => {
  assert.equal(
    formatContinuitySummaryFailureNotice('provider timeout'),
    'Clawa continuity summary failed; Pi will use native compaction: provider timeout',
  )
})

test('continuity handler passes configured summaryMaxTokens independent of reserveTokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-continuity-handler-'))
  try {
    const completionCalls: Array<{ maxTokens?: number | undefined }> = []
    const complete = (async (_model, _context, options) => {
      completionCalls.push({ maxTokens: options?.maxTokens })
      return {
        stopReason: 'stop',
        content: [{ type: 'text', text: CONTINUITY_RESPONSE }],
      }
    }) as ContinuityCompletionFn

    const { pi, handlers } = createCapturePi()
    registerContinuityCompaction(pi, () => ({ summaryMaxTokens: 20_000 }), complete)
    const handler = handlers.get('session_before_compact')?.[0]
    assert.ok(handler)
    const { ctx } = await createContinuityCtx(root)
    const result = await handler(createCompactionEvent(150_000), ctx)

    assert.equal(completionCalls.length, 1)
    assert.equal(completionCalls[0]?.maxTokens, 20_000)
    assert.ok(result && typeof result === 'object' && 'compaction' in result)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('continuity handler clamps completion maxTokens to positive model.maxTokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-continuity-clamp-'))
  try {
    const completionCalls: Array<{ maxTokens?: number | undefined }> = []
    const complete = (async (_model, _context, options) => {
      completionCalls.push({ maxTokens: options?.maxTokens })
      return {
        stopReason: 'stop',
        content: [{ type: 'text', text: CONTINUITY_RESPONSE }],
      }
    }) as ContinuityCompletionFn

    const { pi, handlers } = createCapturePi()
    registerContinuityCompaction(pi, () => ({ summaryMaxTokens: 20_000 }), complete)
    const handler = handlers.get('session_before_compact')?.[0]
    assert.ok(handler)
    const { ctx } = await createContinuityCtx(root)
    ;(ctx.model as { maxTokens: number }).maxTokens = 8_192

    await handler(createCompactionEvent(), ctx)

    assert.equal(completionCalls.length, 1)
    assert.equal(completionCalls[0]?.maxTokens, 8_192)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('continuity handler returns undefined and warns on completion failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-continuity-failure-'))
  try {
    const complete = (async () => {
      throw new Error('provider timeout')
    }) as ContinuityCompletionFn

    const { pi, handlers } = createCapturePi()
    registerContinuityCompaction(pi, () => ({ summaryMaxTokens: 20_000 }), complete)
    const handler = handlers.get('session_before_compact')?.[0]
    assert.ok(handler)
    const { ctx, notifications } = await createContinuityCtx(root)

    const result = await handler(createCompactionEvent(), ctx)

    assert.equal(result, undefined)
    assert.deepEqual(
      notifications.filter((entry) => entry.severity === 'warning'),
      [
        {
          message: formatContinuitySummaryFailureNotice('provider timeout'),
          severity: 'warning',
        },
      ],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
