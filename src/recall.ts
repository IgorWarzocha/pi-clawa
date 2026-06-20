import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { formatRecallResults } from './recall/format.js'
import { searchMemory } from './recall/memory-source.js'
import {
  compareResults,
  DEFAULT_RECALL_LIMIT,
  MAX_RECALL_LIMIT,
  normalizeLimit,
  tokenize,
} from './recall/scoring.js'
import { dedupeFiles, discoverSessionFiles } from './recall/session-files.js'
import { searchSessionFile } from './recall/session-source.js'
import type { RecallResult, RecallSearchInput } from './recall/types.js'

export type { RecallResult, RecallSearchInput } from './recall/types.js'

export function searchRecall(input: RecallSearchInput): RecallResult[] {
  const tokens = tokenize(input.query)
  const limit = normalizeLimit(input.limit)
  const memoryResults = searchMemory(input, tokens)
  const sessionResults = dedupeFiles(input.sessionFiles ?? []).flatMap((file) =>
    searchSessionFile(file, tokens),
  )
  return [...memoryResults, ...sessionResults].sort(compareResults).slice(0, limit)
}

export function registerRecallTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'recall',
    label: 'Recall',
    description:
      'Search shared memory and this Clawa session, returning memory ids and file/line anchors.',
    promptSnippet: 'Search shared memory and this session.',
    promptGuidelines: [
      'recall: Use before assuming I have no past context.',
      'recall: Search when a past human preference, spark, or decision may matter.',
      'recall: Session search skips tool calls and tool results.',
    ],
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: 'Search words. Omit for recent entries.',
        }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          maxItems: 12,
          description: 'Filter memories by tags; sessions ignore tags.',
        }),
      ),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_RECALL_LIMIT,
          description: `Default ${DEFAULT_RECALL_LIMIT}; max ${MAX_RECALL_LIMIT}.`,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const results = searchRecall({
          cwd: ctx.cwd,
          query: typeof params.query === 'string' ? params.query : undefined,
          tags: Array.isArray(params.tags) ? params.tags : undefined,
          limit: typeof params.limit === 'number' ? params.limit : undefined,
          sessionFiles: discoverSessionFiles(ctx),
        })
        return {
          content: [{ type: 'text' as const, text: formatRecallResults(results, ctx.cwd) }],
          details: { count: results.length, results },
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          details: { count: 0, results: [] },
          isError: true,
        }
      }
    },
  })
}
