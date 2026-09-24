import type { Message } from 'discord.js'
import type { DiscordContextLine, DiscordMessageHandle } from '../bridge/contracts.js'
import type { DiscordConfig } from '../config.js'
import { findCachedDiscordAttachmentPath } from './attachments.js'
import { humanizeDiscordText, sanitizeDiscordLabel } from './sanitize.js'

interface ObservedMessage {
  messageId: string
  senderName: string
  body: string
}

export interface DiscordMessageContext {
  lines: DiscordContextLine[]
  handles: Readonly<Record<string, DiscordMessageHandle>>
}

interface DiscordReplyContext {
  isReplyToBot: boolean
  messages: ObservedMessage[]
}

export async function readDiscordReplyContext(
  message: Message,
  botId: string,
  config: DiscordConfig,
): Promise<DiscordReplyContext> {
  return await readReplyChain(message, botId, config)
}

export async function readDiscordMessageContext(
  message: Message,
  replies: DiscordReplyContext,
  recentLimit: number,
  botId: string,
  config: DiscordConfig,
): Promise<DiscordMessageContext> {
  const replyIds = new Set(replies.messages.map((item) => item.messageId))
  const recent = await readRecentMessages(message, recentLimit, replyIds, botId, config)
  const handles: Record<string, DiscordMessageHandle> = {
    [message.id]: { channelId: message.channelId, messageId: message.id },
  }
  const lines: DiscordContextLine[] = []
  for (const item of recent) {
    handles[item.messageId] = { channelId: message.channelId, messageId: item.messageId }
    lines.push({ ...item, kind: 'recent' })
  }
  for (const item of replies.messages) {
    handles[item.messageId] = { channelId: message.channelId, messageId: item.messageId }
    lines.push({ ...item, kind: 'reply' })
  }
  return { lines, handles }
}

async function readReplyChain(
  message: Message,
  botId: string,
  config: DiscordConfig,
): Promise<{ isReplyToBot: boolean; messages: ObservedMessage[] }> {
  const messages: ObservedMessage[] = []
  const seen = new Set<string>([message.id])
  let reference = message.reference
  let isReplyToBot = false

  while (reference?.messageId && messages.length < 4) {
    if (reference.channelId && reference.channelId !== message.channelId) break
    if (seen.has(reference.messageId)) break
    seen.add(reference.messageId)
    const parent = await message.channel.messages.fetch(reference.messageId).catch(() => null)
    if (!parent) break
    if (messages.length === 0) isReplyToBot = parent.author.id === botId
    messages.push(toObservedMessage(parent, config))
    reference = parent.reference
  }

  messages.reverse()
  return { isReplyToBot, messages }
}

async function readRecentMessages(
  message: Message,
  limit: number,
  excludedIds: ReadonlySet<string>,
  botId: string,
  config: DiscordConfig,
): Promise<ObservedMessage[]> {
  if (limit === 0) return []
  const fetched = await message.channel.messages
    .fetch({ before: message.id, limit: Math.min(100, limit + excludedIds.size) })
    .catch(() => null)
  if (!fetched) return []
  return [...fetched.values()]
    .filter((item) => !excludedIds.has(item.id) && item.author.id !== botId)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .slice(-limit)
    .map((item) => toObservedMessage(item, config))
}

function toObservedMessage(message: Message, config: DiscordConfig): ObservedMessage {
  const senderName =
    sanitizeDiscordLabel(
      message.member?.displayName || message.author.displayName || message.author.username,
    ) || 'Unknown user'
  const text = humanizeDiscordText(message, message.content).replace(/\s+/gu, ' ').trim()
  const attachments = [...message.attachments.values()].slice(0, 3).map((attachment, index) => {
    const name = sanitizeDiscordLabel(attachment.name || 'attachment') || 'attachment'
    const path = findCachedDiscordAttachmentPath(
      config.assetsDir,
      message.id,
      message.createdAt,
      index,
      {
        url: attachment.url,
        name,
        contentType: sanitizeDiscordLabel(attachment.contentType || ''),
        size: attachment.size,
      },
    )
    return path ? `${name} at ${path}` : name
  })
  const body = [text, attachments.length > 0 ? `[attached: ${attachments.join('; ')}]` : '']
    .filter(Boolean)
    .join(' ')
  return { messageId: message.id, senderName, body: truncate(body || '[No text]', 1_000) }
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}
