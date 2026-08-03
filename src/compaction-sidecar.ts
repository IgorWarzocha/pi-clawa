import { randomUUID } from 'node:crypto'
import type { ThinkingLevel } from '@earendil-works/pi-ai'
import { completeSimple } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
  SessionCompactEvent,
} from '@earendil-works/pi-coding-agent'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import type { ClawaCompactionConfig } from './config.js'
import { rememberMemories } from './memory.js'

const MAX_MEMORY_LINES = 3
const LINE_SPLIT_REGEX = /\r?\n/
const LIST_PREFIX_REGEX = /^[-*]\s*/
const TAGGED_MEMORY_REGEX = /^\[(.+?)\]\s*(.+)$/
const CLAWAS_COORDINATION_TOOLS = new Set(['message_clawa', 'message_main_claw'])

export type StagedMemory = {
  tags: string[]
  content: string
}

type SidecarMatch = {
  parentEntryId: string | null
  reason: SessionBeforeCompactEvent['reason']
}

type PendingSidecar<T> = SidecarMatch & {
  controller: AbortController
  detachSourceAbort: () => void
  token: symbol
  result: Promise<T | undefined>
}

export type CompactionSidecarState<T> = {
  begin: (input: {
    match: SidecarMatch
    signal: AbortSignal
    run: (signal: AbortSignal) => Promise<T>
    onError?: ((error: unknown) => void) | undefined
  }) => symbol
  consume: (match: SidecarMatch) => Promise<T | undefined>
  hasPending: () => boolean
  invalidate: () => void
}

export function createCompactionSidecarState<T>(): CompactionSidecarState<T> {
  let pending: PendingSidecar<T> | undefined

  const invalidate = () => {
    const stale = pending
    pending = undefined
    if (!stale) return
    stale.detachSourceAbort()
    stale.controller.abort(new Error('Clawa compaction sidecar invalidated'))
  }

  return {
    begin: ({ match, signal, run, onError }) => {
      invalidate()
      const controller = new AbortController()
      const token = Symbol('clawa-compaction-sidecar')
      const abortFromSource = () => controller.abort(signal.reason)
      signal.addEventListener('abort', abortFromSource, { once: true })
      if (signal.aborted) abortFromSource()

      const operation: PendingSidecar<T> = {
        ...match,
        controller,
        detachSourceAbort: () => signal.removeEventListener('abort', abortFromSource),
        token,
        result: Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted()
            return run(controller.signal)
          })
          .catch((error: unknown) => {
            if (pending?.token === token && !controller.signal.aborted) {
              try {
                onError?.(error)
              } catch {
                // A UI notification failure must not escape the detached operation.
              }
            }
            return undefined
          }),
      }
      pending = operation
      return token
    },
    consume: async (match) => {
      const owned = pending
      if (!owned || owned.parentEntryId !== match.parentEntryId || owned.reason !== match.reason) {
        return undefined
      }

      // The canonical entry now exists. Only sidecar-owned lifecycle invalidation may abort this wait.
      owned.detachSourceAbort()
      const result = await owned.result
      if (pending?.token !== owned.token) return undefined
      pending = undefined
      if (owned.controller.signal.aborted) return undefined
      return result
    },
    hasPending: () => pending !== undefined,
    invalidate,
  }
}

function extractBlock(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? ''
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
}

export function parseStagedMemories(text: string): StagedMemory[] {
  const block = extractBlock(text, 'memories')
  if (!block) throw new Error('Clawa compaction sidecar returned no memories block')

  const lines = block
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.replace(LIST_PREFIX_REGEX, '').trim())
    .filter((line) => line && line.toUpperCase() !== 'NONE')

  const memories: StagedMemory[] = []
  for (const line of lines) {
    const tagged = line.match(TAGGED_MEMORY_REGEX)
    if (tagged) {
      const content = tagged[2]?.trim() ?? ''
      if (content) {
        memories.push({
          tags: normalizeTags((tagged[1] ?? '').split(',')),
          content,
        })
      }
    } else {
      memories.push({ tags: [], content: line })
    }

    if (memories.length >= MAX_MEMORY_LINES) break
  }
  return memories
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  return content
    .filter((block): block is { type: string; text?: string } => {
      return typeof block === 'object' && block !== null && 'type' in block
    })
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
}

function serializeClawasCoordination(block: {
  name: string
  arguments?: Record<string, unknown>
}): string | undefined {
  if (!CLAWAS_COORDINATION_TOOLS.has(block.name)) return undefined

  const message = block.arguments?.['message']
  if (typeof message !== 'string' || !message.trim()) return undefined

  const configuredTarget = block.arguments?.['claw']
  const target =
    typeof configuredTarget === 'string' && configuredTarget.trim()
      ? configuredTarget.trim()
      : 'Main Clawa'
  return `[Assistant Clawas note to ${target}]: ${message.trim()}`
}

function serializeAssistantBlocks(content: Array<{ type: string; text?: string }>): string[] {
  const textParts = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
  const coordination = content
    .filter(
      (
        block,
      ): block is {
        type: string
        name: string
        arguments?: Record<string, unknown>
      } => block.type === 'toolCall' && 'name' in block && typeof block.name === 'string',
    )
    .map(serializeClawasCoordination)
    .filter((entry): entry is string => Boolean(entry))

  return [
    textParts.length > 0 ? `[Assistant]: ${textParts.join('\n')}` : '',
    ...coordination,
  ].filter(Boolean)
}

function serializeLeanMessage(msg: ReturnType<typeof convertToLlm>[number]): string[] {
  if (msg.role === 'user') {
    const text = extractTextContent(msg.content)
    return text ? [`[User]: ${text}`] : []
  }
  if (msg.role === 'assistant') return serializeAssistantBlocks(msg.content)
  if (msg.role === 'toolResult' && CLAWAS_COORDINATION_TOOLS.has(msg.toolName)) {
    const text = extractTextContent(msg.content)
    return text ? [`[Clawas delivery result]: ${text}`] : []
  }
  return []
}

function serializeConversation(event: SessionBeforeCompactEvent): string {
  const messages = [
    ...event.preparation.messagesToSummarize,
    ...event.preparation.turnPrefixMessages,
  ]
  return convertToLlm(messages).flatMap(serializeLeanMessage).join('\n\n')
}

function buildMemoryPrompt(conversationText: string): string {
  return `Observe this conversation segment as it is compacted by Pi's configured compactor.
Extract only durable little sparks worth keeping outside session history: human texture, curiosity,
taste, corrections, identity-shaping moments, or genuinely important home/project direction.

Do not write a continuity summary, patch notes, completion ledger, or stale TODO recap. Pi's
configured compactor exclusively owns canonical session continuity.

Return exactly this format:

<memories>
Write 0-3 short memory lines. If nothing deserves memory, write NONE.
Use exactly one line per memory:
[tag1, tag2, tag3] Memory text here
</memories>

<conversation>
${conversationText}
</conversation>`
}

type ActiveModel = NonNullable<ExtensionContext['model']>
type ActiveModelAuth = {
  apiKey: string
  headers?: Record<string, string> | undefined
  env?: Record<string, string> | undefined
}

export function parseSidecarModelRef(modelRef: string): { provider: string; modelId: string } {
  const separator = modelRef.indexOf('/')
  if (separator <= 0 || separator === modelRef.length - 1) {
    throw new Error(`Invalid Clawa compaction sidecar model: ${modelRef}`)
  }
  return {
    provider: modelRef.slice(0, separator),
    modelId: modelRef.slice(separator + 1),
  }
}

function resolveSidecarModel(
  ctx: ExtensionContext,
  configuredModel: string | undefined,
): ActiveModel {
  if (!configuredModel) {
    if (!ctx.model)
      throw new Error('Clawa compaction sidecar requires an active or configured model')
    return ctx.model
  }

  const { provider, modelId } = parseSidecarModelRef(configuredModel)
  const model = ctx.modelRegistry.find(provider, modelId)
  if (!model) throw new Error(`Clawa compaction sidecar model not found: ${configuredModel}`)
  return model
}

async function resolveActiveModelAuth(
  ctx: ExtensionContext,
  model: ActiveModel,
): Promise<ActiveModelAuth> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok) throw new Error(auth.error)
  if (!auth.apiKey) {
    throw new Error(`Clawa compaction sidecar cannot resolve an API key for ${model.provider}`)
  }
  return {
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
  }
}

function extractCompletionText(response: Awaited<ReturnType<typeof completeSimple>>): string {
  if (response.stopReason !== 'stop') {
    throw new Error(`Clawa compaction sidecar stopped early (${response.stopReason})`)
  }

  return response.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

async function extractMemories(
  pi: ExtensionAPI,
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  signal: AbortSignal,
  configuredModel: string | undefined,
): Promise<StagedMemory[]> {
  const conversationText = serializeConversation(event)
  if (!conversationText) return []

  const model = resolveSidecarModel(ctx, configuredModel)
  const auth = await resolveActiveModelAuth(ctx, model)
  const thinkingLevel = pi.getThinkingLevel() as ThinkingLevel | undefined
  const response = await completeSimple(
    model,
    {
      systemPrompt:
        'You extract a few durable Clawa memories from a conversation segment without authoring session continuity.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildMemoryPrompt(conversationText) }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      ...(auth.headers ? { headers: auth.headers } : {}),
      ...(auth.env ? { env: auth.env } : {}),
      signal,
      ...(thinkingLevel ? { reasoning: thinkingLevel } : {}),
      cacheRetention: 'none',
      sessionId: randomUUID(),
    },
  )
  return parseStagedMemories(extractCompletionText(response))
}

function matchBeforeEvent(event: SessionBeforeCompactEvent): SidecarMatch {
  return {
    parentEntryId: event.branchEntries.at(-1)?.id ?? null,
    reason: event.reason,
  }
}

function matchCompactEvent(event: SessionCompactEvent): SidecarMatch {
  // The saved entry's parent is the pre-compaction leaf captured by session_before_compact.
  return {
    parentEntryId: event.compactionEntry.parentId,
    reason: event.reason,
  }
}

function captureNotifier(ctx: ExtensionContext) {
  if (!ctx.hasUI) return undefined
  const notify = ctx.ui.notify.bind(ctx.ui)
  return {
    sidecarFailed: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      notify(`Clawa compaction sidecar failed: ${message}`, 'warning')
    },
    memoryWriteFailed: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      notify(`Clawa memory write failed: ${message}`, 'warning')
    },
  }
}

export function registerCompactionSidecar(
  pi: ExtensionAPI,
  getCompactionConfig: () => ClawaCompactionConfig,
): void {
  const state = createCompactionSidecarState<StagedMemory[]>()

  pi.on('session_before_compact', (event, ctx) => {
    const notifier = captureNotifier(ctx)
    const configuredModel = getCompactionConfig().sidecarModel
    state.begin({
      match: matchBeforeEvent(event),
      signal: event.signal,
      run: (signal) => extractMemories(pi, event, ctx, signal, configuredModel),
      onError: notifier?.sidecarFailed,
    })
    // Pi cannot compose compaction results. Its configured compactor remains the sole history owner.
    return undefined
  })

  pi.on('session_compact', async (event, ctx) => {
    const memories = await state.consume(matchCompactEvent(event))
    if (!memories) return

    try {
      rememberMemories(
        ctx.cwd,
        memories.map((memory) => ({ text: memory.content, tags: memory.tags })),
      )
    } catch (error) {
      captureNotifier(ctx)?.memoryWriteFailed(error)
    }
  })

  const invalidate = () => state.invalidate()
  pi.on('session_start', invalidate)
  pi.on('session_shutdown', invalidate)
  pi.on('session_tree', invalidate)
}
