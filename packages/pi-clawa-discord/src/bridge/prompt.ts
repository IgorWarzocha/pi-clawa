import type { DiscordInboundTurn } from './contracts.js'
import { buildDiscordRoutes, type DiscordRouteRegistry, type DiscordRoutes } from './routes.js'

export function buildDiscordPrompt(
  turns: readonly DiscordInboundTurn[],
  routes: DiscordRoutes,
): string {
  const first = turns[0]
  if (!first) throw new Error('A Discord prompt needs at least one message.')
  return [
    `Discord · ${first.channelLabel}`,
    ...turns.flatMap((turn) => formatTurn(turn, routes)),
  ].join('\n')
}

function formatTurn(turn: DiscordInboundTurn, routes: DiscordRoutes): string[] {
  const context = turn.context.map(
    (item) => `${messageLabel(item.messageId, routes)}${item.senderName}: ${item.body}`,
  )
  const attachments = turn.attachments.map(
    (attachment) =>
      `${attachment.name} · ${attachment.contentType || 'file'} · ${attachment.size} bytes\npath: ${attachment.localPath}`,
  )
  return [
    '',
    ...(context.length > 0 ? ['Recent context:', ...context, ''] : []),
    `${messageLabel(turn.replyToMessageId, routes)}${turn.senderName} at ${turn.receivedAt}:`,
    turn.body || '[No text]',
    ...(attachments.length > 0 ? ['Attachments:', ...attachments] : []),
  ]
}

function messageLabel(id: string, routes: DiscordRoutes): string {
  const handle = routes.messageHandlesById.get(id)
  return handle ? `[${handle}] ` : ''
}

export function buildDiscordSystemPrompt(
  turns: readonly DiscordInboundTurn[],
  registry: DiscordRouteRegistry,
): string {
  const routes = buildDiscordRoutes(turns, registry)
  return [
    turns.every((turn) => turn.cause === 'ambient')
      ? 'An ambient Discord batch. Join in or stay quiet as you see fit.'
      : 'Respond to the current Discord messages.',
    'Discord final replies use ordered blocks. Start a line with [mN] to reply to that shown message, or [c] to post in the current channel. Unmarked text stays in Pi.',
    `Messages: ${routes.messages.map((route) => route.handle).join(', ') || 'none'}`,
    `Current channel: ${routes.channel?.channelLabel ?? 'none'}`,
    'Use discord_send for rich delivery or other destinations. Its replyTo and reaction.to take mN handles.',
  ].join('\n')
}
