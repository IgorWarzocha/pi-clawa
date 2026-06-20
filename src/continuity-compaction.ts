import { completeSimple, type ThinkingLevel } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionBeforeCompactEvent,
} from '@earendil-works/pi-coding-agent'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { rememberMemory, resolveMemoryDbPath } from './memory.js'

const MAX_MEMORY_LINES = 3
const COMPACTION_KIND = 'clawa-continuity-v1'
const LINE_SPLIT_REGEX = /\r?\n/
const LIST_PREFIX_REGEX = /^[-*]\s*/
const TAGGED_MEMORY_REGEX = /^\[(.+?)\]\s*(.+)$/

type MemoryLine = {
  tags: string[]
  content: string
}

function extractBlock(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return match?.[1]?.trim() ?? ''
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
}

function parseMemoryLines(text: string): MemoryLine[] {
  const lines = text
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.replace(LIST_PREFIX_REGEX, '').trim())
    .filter((line) => line && line.toUpperCase() !== 'NONE')

  const memories: MemoryLine[] = []
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

function serializeToolCall(block: { name: string; arguments?: Record<string, unknown> }): string {
  const args = Object.entries(block.arguments ?? {})
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ')
  return `${block.name}(${args})`
}

function serializeAssistantBlocks(content: Array<{ type: string; text?: string }>): string[] {
  const textParts = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
  const toolCalls = content
    .filter(
      (
        block,
      ): block is {
        type: string
        name: string
        arguments?: Record<string, unknown>
      } => {
        return block.type === 'toolCall' && 'name' in block && typeof block.name === 'string'
      },
    )
    .map(serializeToolCall)

  return [
    textParts.length > 0 ? `[Assistant]: ${textParts.join('\n')}` : '',
    toolCalls.length > 0 ? `[Assistant tool calls]: ${toolCalls.join('; ')}` : '',
  ].filter(Boolean)
}

function serializeLeanMessage(msg: ReturnType<typeof convertToLlm>[number]): string[] {
  if (msg.role === 'user') {
    const text = extractTextContent(msg.content)
    return text ? [`[User]: ${text}`] : []
  }
  if (msg.role === 'assistant') return serializeAssistantBlocks(msg.content)
  return []
}

function serializeLeanConversation(messages: ReturnType<typeof convertToLlm>): string {
  return messages.flatMap(serializeLeanMessage).join('\n\n')
}

function buildCompactionPrompt(input: {
  conversationText: string
  customInstructions?: string | undefined
  fileOps?: unknown
  previousSummary?: string | undefined
}): string {
  const previousContext = input.previousSummary?.trim()
    ? `\n<previous_continuity>\n${input.previousSummary.trim()}\n</previous_continuity>\n`
    : ''
  const fileOpsText = input.fileOps
    ? `\n<file_ops>\n${JSON.stringify(input.fileOps, null, 2)}\n</file_ops>\n`
    : ''
  const customText = input.customInstructions?.trim()
    ? `\n<custom_instructions>\n${input.customInstructions.trim()}\n</custom_instructions>\n`
    : ''

  return `You are writing Clawa compaction output.

This is not normal technical compaction. Preserve continuity and extract durable memories.
The continuity summary is for future assistant-self after context loss. It should help the assistant wake up in the same shape: current work, tone, relationship, user corrections, important decisions, and the next live move.
The memories are separate. They are durable little sparks worth keeping outside the compacted conversation.

Avoid ticket voice, generic progress logs, completion ledgers, and stale TODO recaps.
Do not keep completed work alive as open work.
Prefer current state over chronological recap.
Keep the summary compact, useful, and alive.
Only mention file paths when they materially help continuation.

Return exactly this format:

<continuity>
## Where We Are
One short natural paragraph that helps future assistant re-enter the work smoothly.

## What Matters
- 2-5 short bullets with only live decisions, constraints, corrections, and anchor facts that matter now

## Open Threads
- 0-3 bullets with only unresolved or explicitly deferred work
- If nothing is live, write: - None.

## Working Memory
- 1-4 bullets with details future assistant should not have to rediscover next session
</continuity>

<memories>
Write 0-3 short memory lines worth storing durably.
These are not patch notes. Prefer human texture, curiosity sparks, taste, corrections, identity-shaping moments, or genuinely important home/project direction.
If nothing deserves memory, write NONE.
Use exactly one line per memory:
[tag1, tag2, tag3] Memory text here
</memories>

${previousContext}${fileOpsText}${customText}
<conversation>
${input.conversationText}
</conversation>`
}

type ActiveModel = NonNullable<ExtensionContext['model']>
type ActiveModelAuth = {
  apiKey: string
  headers?: Record<string, string>
}
type SimpleCompletionResponse = Awaited<ReturnType<typeof completeSimple>>

type PreparedCompaction = {
  conversationText: string
  customInstructions?: string | undefined
  fileOps?: unknown
  firstKeptEntryId: SessionBeforeCompactEvent['preparation']['firstKeptEntryId']
  previousSummary?: string | undefined
  signal: AbortSignal
  tokensBefore: SessionBeforeCompactEvent['preparation']['tokensBefore']
}

function prepareCompactionInput(event: SessionBeforeCompactEvent): PreparedCompaction | undefined {
  const { preparation, customInstructions, signal } = event
  const {
    messagesToSummarize,
    turnPrefixMessages,
    previousSummary,
    firstKeptEntryId,
    tokensBefore,
  } = preparation
  const allMessages = [...messagesToSummarize, ...turnPrefixMessages]
  if (allMessages.length === 0 && !previousSummary?.trim()) return undefined

  return {
    conversationText: serializeLeanConversation(convertToLlm(allMessages)),
    customInstructions,
    fileOps: (preparation as { fileOps?: unknown }).fileOps,
    firstKeptEntryId,
    previousSummary,
    signal,
    tokensBefore,
  }
}

function requireActiveModel(ctx: ExtensionContext): ActiveModel {
  if (!ctx.model) throw new Error('Clawa compaction requires the active Pi model')
  return ctx.model
}

async function resolveActiveModelAuth(
  ctx: ExtensionContext,
  model: ActiveModel,
): Promise<ActiveModelAuth> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok) throw new Error(auth.error)
  if (!auth.apiKey)
    throw new Error(`Clawa compaction cannot resolve an API key for ${model.provider}`)
  return {
    apiKey: auth.apiKey,
    ...(auth.headers ? { headers: auth.headers } : {}),
  }
}

function extractCompletionText(response: SimpleCompletionResponse): string {
  if (response.stopReason !== 'stop') {
    throw new Error(`Clawa compaction stopped early (${response.stopReason})`)
  }

  return response.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function extractContinuitySummary(text: string): string {
  const summary = extractBlock(text, 'continuity')
  if (!summary) throw new Error('Clawa compaction returned no continuity block')
  return summary
}

function writeCompactionMemories(cwd: string, text: string): { path: string; count: number } {
  let memoryWrite = { path: resolveMemoryDbPath(cwd), count: 0 }
  for (const memory of parseMemoryLines(extractBlock(text, 'memories'))) {
    const result = rememberMemory(cwd, { text: memory.content, tags: memory.tags })
    memoryWrite = { path: result.path, count: memoryWrite.count + 1 }
  }
  return memoryWrite
}

function notifyCompactionFailure(ctx: ExtensionContext, signal: AbortSignal, error: unknown): void {
  if (signal.aborted || !ctx.hasUI) return
  const message = error instanceof Error ? error.message : String(error)
  ctx.ui.notify(`Clawa compaction failed: ${message}`, 'warning')
}

function notifyMemoryFailure(ctx: ExtensionContext, signal: AbortSignal, error: unknown): void {
  if (signal.aborted || !ctx.hasUI) return
  const message = error instanceof Error ? error.message : String(error)
  ctx.ui.notify(`Clawa memory write failed: ${message}`, 'warning')
}

export function registerContinuityCompaction(pi: ExtensionAPI): void {
  pi.on('session_before_compact', async (event, ctx) => {
    const prepared = prepareCompactionInput(event)
    if (!prepared) return

    try {
      const model = requireActiveModel(ctx)
      const auth = await resolveActiveModelAuth(ctx, model)
      const prompt = buildCompactionPrompt(prepared)
      if (ctx.hasUI) ctx.ui.notify(`Clawa compaction via ${model.provider}/${model.id}`, 'info')

      const thinkingLevel = pi.getThinkingLevel() as ThinkingLevel | undefined
      const response = await completeSimple(
        model,
        {
          systemPrompt:
            'You write precise Clawa continuity compactions. Preserve future-self continuity and extract durable memories. Avoid stale technical TODO recaps unless they are truly live.',
          messages: [
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          ...(auth.headers ? { headers: auth.headers } : {}),
          signal: prepared.signal,
          ...(thinkingLevel ? { reasoning: thinkingLevel } : {}),
          maxTokens: 32768,
        },
      )

      const text = extractCompletionText(response)
      const summary = extractContinuitySummary(text)
      let memoryWrite = { path: resolveMemoryDbPath(ctx.cwd), count: 0 }
      try {
        memoryWrite = writeCompactionMemories(ctx.cwd, text)
      } catch (error) {
        notifyMemoryFailure(ctx, prepared.signal, error)
      }

      return {
        compaction: {
          summary,
          firstKeptEntryId: prepared.firstKeptEntryId,
          tokensBefore: prepared.tokensBefore,
          details: {
            kind: COMPACTION_KIND,
            memoryCount: memoryWrite.count,
            memoryPath: memoryWrite.path,
            fileOps: prepared.fileOps,
          },
        },
      }
    } catch (error) {
      notifyCompactionFailure(ctx, prepared.signal, error)
      return
    }
  })
}
