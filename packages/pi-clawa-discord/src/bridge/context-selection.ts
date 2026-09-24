import type { DiscordInboundTurn } from './contracts.js'
import type { DiscordRouteRegistry } from './routes.js'

export function selectDiscordContext(
  turns: readonly DiscordInboundTurn[],
  registry: DiscordRouteRegistry,
): DiscordInboundTurn[] {
  const currentMessageIds = new Set(
    turns.flatMap((turn) => [turn.sourceMessageId, turn.replyToMessageId]),
  )
  const includedInBatch = new Set<string>()

  return turns.map((turn) => ({
    ...turn,
    context: turn.context.filter((item) => {
      if (includedInBatch.has(item.messageId)) return false
      if (item.kind === 'recent') {
        if (currentMessageIds.has(item.messageId) || registry.hasMessage(item.messageId)) {
          return false
        }
      }
      includedInBatch.add(item.messageId)
      return true
    }),
  }))
}
