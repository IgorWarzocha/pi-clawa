import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { completeSimple, type ThinkingLevel } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { findRepoRoot } from './config.js'

const MEMORY_JSONL_PATH = join('.pi', 'clawa-memory.jsonl')
const MAX_MEMORY_LINES = 3
const COMPACTION_KIND = 'clawa-continuity-v1'
const LINE_SPLIT_REGEX = /\r?\n/
const LIST_PREFIX_REGEX = /^[-*]\s*/
const TAGGED_MEMORY_REGEX = /^\[(.+?)\]\s*(.+)$/

type MemoryRecord = {
  type: 'memory'
  source: 'compaction'
  createdAt: string
  timestamp: number
  cwd: string
  tags: string[]
  content: string
  compaction: {
    firstKeptEntryId: string
    tokensBefore: number
  }
}

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
        memories.push({ tags: normalizeTags((tagged[1] ?? '').split(',')), content })
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
      (block): block is { type: string; name: string; arguments?: Record<string, unknown> } => {
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

Avoid Jira voice, generic progress logs, completion ledgers, and TODO sludge.
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
These are not patch notes. Store things that make the assistant better later: user preferences, relationship texture, recurring motifs, durable behavior corrections, taste, identity-shaping moments, or genuinely important project direction.
If nothing deserves memory, write NONE.
Use exactly one line per memory:
[tag1, tag2, tag3] Memory text here
</memories>

${previousContext}${fileOpsText}${customText}
<conversation>
${input.conversationText}
</conversation>`
}

function appendMemories(
  repoRoot: string,
  cwd: string,
  memories: MemoryLine[],
  compaction: MemoryRecord['compaction'],
) {
  if (memories.length === 0) return { path: join(repoRoot, MEMORY_JSONL_PATH), count: 0 }

  const memoryPath = join(repoRoot, MEMORY_JSONL_PATH)
  mkdirSync(dirname(memoryPath), { recursive: true })
  const timestamp = Date.now()
  const createdAt = new Date(timestamp).toISOString()
  const lines = memories.map((memory) => {
    const record: MemoryRecord = {
      type: 'memory',
      source: 'compaction',
      createdAt,
      timestamp,
      cwd,
      tags: memory.tags,
      content: memory.content,
      compaction,
    }
    return JSON.stringify(record)
  })
  appendFileSync(memoryPath, `${lines.join('\n')}\n`, 'utf8')
  return { path: memoryPath, count: memories.length }
}

export function registerContinuityCompaction(pi: ExtensionAPI): void {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Linear fallback pipeline for the compaction hook.
  pi.on('session_before_compact', async (event, ctx) => {
    const { preparation, customInstructions, signal } = event
    const {
      messagesToSummarize,
      turnPrefixMessages,
      previousSummary,
      firstKeptEntryId,
      tokensBefore,
    } = preparation
    const allMessages = [...messagesToSummarize, ...turnPrefixMessages]
    if (allMessages.length === 0 && !previousSummary?.trim()) return

    const model = ctx.model
    if (!model) {
      if (ctx.hasUI)
        ctx.ui.notify('Clawa compaction found no active model; using default compaction', 'warning')
      return
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)
    if (!(auth.ok && auth.apiKey)) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          auth.ok ? `No API key for ${model.provider}; using default compaction` : auth.error,
          'warning',
        )
      }
      return
    }

    const conversationText = serializeLeanConversation(convertToLlm(allMessages))
    const fileOps = (preparation as { fileOps?: unknown }).fileOps
    const prompt = buildCompactionPrompt({
      conversationText,
      previousSummary,
      customInstructions,
      fileOps,
    })

    try {
      if (ctx.hasUI) {
        ctx.ui.notify(`Clawa compaction via ${model.provider}/${model.id}`, 'info')
      }

      const thinkingLevel = pi.getThinkingLevel() as ThinkingLevel | undefined
      const response = await completeSimple(
        model,
        {
          systemPrompt:
            'You write precise Clawa continuity compactions. Preserve future-self continuity and extract durable memories. Avoid technical TODO sludge unless it is truly live.',
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
          signal,
          ...(thinkingLevel ? { reasoning: thinkingLevel } : {}),
          maxTokens: 32768,
        },
      )

      if (response.stopReason !== 'stop') {
        if (!signal.aborted && ctx.hasUI) {
          ctx.ui.notify(
            `Clawa compaction stopped early (${response.stopReason}); using default compaction`,
            'warning',
          )
        }
        return
      }

      const text = response.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      const summary = extractBlock(text, 'continuity')
      if (!summary) {
        if (!signal.aborted && ctx.hasUI) {
          ctx.ui.notify(
            'Clawa compaction returned no continuity block; using default compaction',
            'warning',
          )
        }
        return
      }

      const memories = parseMemoryLines(extractBlock(text, 'memories'))
      const repoRoot = findRepoRoot(ctx.cwd)
      let memoryWrite = { path: join(repoRoot, MEMORY_JSONL_PATH), count: 0 }
      try {
        memoryWrite = appendMemories(repoRoot, ctx.cwd, memories, {
          firstKeptEntryId,
          tokensBefore,
        })
      } catch (error) {
        if (!signal.aborted && ctx.hasUI) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(`Clawa memory write failed: ${message}`, 'warning')
        }
      }

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
          details: {
            kind: COMPACTION_KIND,
            memoryCount: memoryWrite.count,
            memoryPath: memoryWrite.path,
            fileOps,
          },
        },
      }
    } catch (error) {
      if (!signal.aborted && ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Clawa compaction failed, using default compaction: ${message}`, 'warning')
      }
      return
    }
  })
}
