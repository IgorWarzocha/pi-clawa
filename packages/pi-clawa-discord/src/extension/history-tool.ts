import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { MAX_HISTORY_LIMIT, searchDiscordHistory } from '../discord/history.js'

const schema = Type.Object(
  {
    query: Type.Optional(Type.String({ description: 'Omit for recent' })),
    speaker: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
    role: Type.Optional(StringEnum(['user', 'assistant', 'reaction'] as const)),
    around: Type.Optional(
      Type.Integer({ minimum: 1, description: 'Expand a returned row in its channel' }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_HISTORY_LIMIT })),
  },
  { additionalProperties: false },
)

export function registerDiscordHistoryTool(pi: ExtensionAPI) {
  const tool = defineTool({
    name: 'discord_history',
    label: 'Discord History',
    description: 'Search this bot home’s room history or expand a conversation.',
    parameters: schema,
    async execute(_id, input, _signal, _update, context) {
      if (
        input.around !== undefined &&
        (input.query || input.speaker || input.channel || input.role)
      ) {
        throw new Error('Use around alone, with an optional limit.')
      }
      const results = searchDiscordHistory(context.cwd, input).map((result) => ({
        ...result,
        content:
          result.content.length > 1_000
            ? `${result.content.slice(0, 1_000)} [truncated]`
            : result.content,
      }))
      const text =
        results.length === 0
          ? 'No matching Discord history.'
          : results
              .map(
                (result) =>
                  '[' +
                  result.rowId +
                  '] ' +
                  result.timestamp +
                  ' · ' +
                  result.channelName +
                  ' · ' +
                  result.senderName +
                  '\n' +
                  result.content,
              )
              .join('\n\n')
      return {
        content: [{ type: 'text' as const, text }],
        details: { count: results.length, results },
      }
    },
  })
  pi.registerTool(tool)
  return tool
}
