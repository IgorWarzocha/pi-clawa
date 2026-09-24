import type { Message } from 'discord.js'
import type { DiscordInboundTurn } from '../bridge/contracts.js'
import type { DiscordConfig } from '../config.js'
import type { DiscordActivityEvent } from './activity.js'
import {
  type AttachmentCacheResult,
  cacheDiscordAttachments,
  type DiscordAttachmentCandidate,
} from './attachments.js'
import { readDiscordMessageContext, readDiscordReplyContext } from './context.js'
import type { DiscordHistoryEntry } from './history.js'
import { appendDiscordLinksIndex, buildDiscordLinkMetas } from './links.js'
import { buildAliasPattern, canUseDiscordChannel, shouldAcceptDiscordMessage } from './policy.js'
import { humanizeDiscordText, sanitizeDiscordLabel, sanitizeDiscordText } from './sanitize.js'

export interface DiscordInboundDependencies {
  config: DiscordConfig
  signal: AbortSignal
  botId: string
  archive(entry: DiscordHistoryEntry): void
  chatEnabled(): boolean
  observe(event: DiscordActivityEvent): void
  enqueue(turn: DiscordInboundTurn): boolean
  enqueueAmbient(turn: DiscordInboundTurn): void
  report(message: string, level: 'info' | 'warning' | 'error'): void
}

export function createDiscordMessageHandler(
  dependencies: DiscordInboundDependencies,
): (message: Message) => Promise<void> {
  const aliasPattern = buildAliasPattern(dependencies.config.triggerAliases)
  return async (message) => await handleDiscordMessage(message, dependencies, aliasPattern)
}

async function handleDiscordMessage(
  message: Message,
  dependencies: DiscordInboundDependencies,
  aliasPattern: RegExp | null,
): Promise<void> {
  if (message.author.bot) return
  const content = sanitizeDiscordText(message.content)
  const activity = toActivityEvent(message, humanizeDiscordText(message, content))
  const assets = await archiveDiscordMessage(message, content, dependencies)
  if (!isAllowedAuthor(message, dependencies.config.allowedUserIds)) {
    dependencies.observe({ ...activity, disposition: 'blocked' })
    return
  }
  const replies = await readDiscordReplyContext(message, dependencies.botId, dependencies.config)
  if (!isDirectedMessage(message, content, replies.isReplyToBot, dependencies, aliasPattern)) {
    dependencies.observe({ ...activity, disposition: 'ambient' })
    enqueueAmbientMessage(message, content, assets, dependencies)
    return
  }
  if (!dependencies.chatEnabled()) {
    dependencies.observe({ ...activity, disposition: 'paused' })
    return
  }
  const context = await readDiscordMessageContext(
    message,
    replies,
    dependencies.config.recentContextMessages,
    dependencies.botId,
    dependencies.config,
  )

  reportRejectedAttachments(assets.rejected, dependencies)

  const body = appendEmbedContext(humanizeDiscordText(message, content.trim()), message)
  if (!body && assets.cached.length === 0) {
    dependencies.observe({ ...activity, disposition: 'blocked' })
    return
  }

  const turn: DiscordInboundTurn = {
    id: message.id,
    cause: 'directed',
    channelId: message.channelId,
    channelLabel: channelLabel(message),
    senderName: senderName(message),
    sourceMessageId: message.id,
    replyToMessageId: message.id,
    body: body || `[Attachment-only message: ${assets.cached.length} file(s).]`,
    receivedAt: message.createdAt.toISOString(),
    context: context.lines,
    attachments: assets.cached,
    handles: context.handles,
  }
  const queued = dependencies.enqueue(turn)
  dependencies.observe({ ...activity, disposition: queued ? 'queued' : 'full' })
  if (!queued) await reportFullQueue(message, dependencies)
}

function enqueueAmbientMessage(
  message: Message,
  content: string,
  assets: AttachmentCacheResult,
  dependencies: DiscordInboundDependencies,
): void {
  if (!(dependencies.chatEnabled() && shouldArchiveDiscordMessage(message, dependencies.config))) {
    return
  }
  const body = appendEmbedContext(humanizeDiscordText(message, content), message)
  if (!body && assets.cached.length === 0) return
  reportRejectedAttachments(assets.rejected, dependencies)
  dependencies.enqueueAmbient({
    id: message.id,
    cause: 'ambient',
    channelId: message.channelId,
    channelLabel: channelLabel(message),
    senderName: senderName(message),
    sourceMessageId: message.id,
    replyToMessageId: message.id,
    body: body || `[Attachment-only message: ${assets.cached.length} file(s).]`,
    receivedAt: message.createdAt.toISOString(),
    context: [],
    attachments: assets.cached,
    handles: {
      [message.id]: { channelId: message.channelId, messageId: message.id },
    },
  })
}

export async function archiveDiscordMessage(
  message: Message,
  content: string,
  dependencies: DiscordInboundDependencies,
): Promise<AttachmentCacheResult> {
  const { config } = dependencies
  if (!shouldArchiveDiscordMessage(message, config)) return { cached: [], rejected: [] }
  archiveHistory(
    message,
    [
      appendEmbedContext(humanizeDiscordText(message, content), message).trim() || '[No text]',
      ...attachmentCandidates(message).map((item) => `[attachment: ${item.name} · ${item.url}]`),
    ].join('\n'),
    dependencies,
  )
  try {
    appendDiscordLinksIndex({
      assetsDir: config.assetsDir,
      messageId: message.id,
      messageUrl: message.url,
      createdAt: message.createdAt,
      senderName: senderName(message),
      channelLabel: channelLabel(message),
      links: buildDiscordLinkMetas(humanizeDiscordText(message, content), message.embeds),
    })
  } catch (error) {
    dependencies.report(
      `Could not archive Discord links: ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    )
  }
  const assets = await cacheDiscordAttachments(
    config,
    message.id,
    message.createdAt,
    attachmentCandidates(message),
    dependencies.signal,
  )
  archiveHistory(message, buildDiscordHistoryContent(message, content, assets), dependencies)
  return assets
}

function shouldArchiveDiscordMessage(message: Message, config: DiscordConfig): boolean {
  if (!message.guild) {
    return config.allowedUserIds.size === 0 || config.allowedUserIds.has(message.author.id)
  }
  return canUseDiscordChannel(config, message.channelId, false)
}

function buildDiscordHistoryContent(
  message: Message,
  content: string,
  assets: AttachmentCacheResult,
): string {
  const body = appendEmbedContext(humanizeDiscordText(message, content), message).trim()
  const cached = assets.cached.map((attachment) => {
    const type = attachment.contentType || 'file'
    return `[attachment: ${attachment.name} · ${type} · ${attachment.size} bytes · ${attachment.localPath}]`
  })
  const rejected = assets.rejected.map(
    (attachment) => `[attachment unavailable: ${attachment.name} · ${attachment.reason}]`,
  )
  return [body || '[No text]', ...cached, ...rejected].join('\n')
}

function archiveHistory(
  message: Message,
  content: string,
  dependencies: DiscordInboundDependencies,
): void {
  dependencies.archive({
    channelId: message.channelId,
    channelName: channelLabel(message),
    role: 'user',
    senderId: message.author.id,
    senderName: senderName(message),
    content,
    timestamp: message.createdAt.toISOString(),
    sourceMessageId: message.id,
  })
}

function isAllowedAuthor(message: Message, allowedUserIds: ReadonlySet<string>): boolean {
  return allowedUserIds.size === 0 || allowedUserIds.has(message.author.id)
}

function isDirectedMessage(
  message: Message,
  content: string,
  isReplyToBot: boolean,
  dependencies: DiscordInboundDependencies,
  aliasPattern: RegExp | null,
): boolean {
  const mentioned =
    message.mentions.users.has(dependencies.botId) ||
    content.includes(`<@${dependencies.botId}>`) ||
    content.includes(`<@!${dependencies.botId}>`)
  return shouldAcceptDiscordMessage({
    isDm: !message.guild,
    channelId: message.channelId,
    channelPolicy: dependencies.config.channelPolicy,
    allowedChannelIds: dependencies.config.allowedChannelIds,
    excludedChannelIds: dependencies.config.excludedChannelIds,
    mentioned,
    isReplyToBot,
    content,
    aliasPattern,
  })
}

function attachmentCandidates(message: Message): DiscordAttachmentCandidate[] {
  return [...message.attachments.values()].map((attachment) => ({
    url: attachment.url,
    name: sanitizeDiscordLabel(attachment.name || 'attachment') || 'attachment',
    contentType: sanitizeDiscordLabel(attachment.contentType || ''),
    size: attachment.size,
  }))
}

function toActivityEvent(
  message: Message,
  content: string,
): Omit<DiscordActivityEvent, 'disposition'> {
  const media = message.attachments.size + message.embeds.length
  const body = [content.trim(), media > 0 ? `[${media} attachment/embed]` : '']
    .filter(Boolean)
    .join(' ')
  return {
    id: message.id,
    channelLabel: channelLabel(message),
    senderName: senderName(message),
    body: body || '[no text]',
    occurredAt: message.createdTimestamp,
  }
}

function senderName(message: Message): string {
  return (
    sanitizeDiscordLabel(
      message.member?.displayName || message.author.displayName || message.author.username,
    ) || 'Unknown user'
  )
}

function reportRejectedAttachments(
  rejected: Array<{ name: string; reason: string }>,
  dependencies: DiscordInboundDependencies,
): void {
  if (rejected.length === 0) return
  const summary = rejected.map((item) => `${item.name}: ${item.reason}`).join(', ')
  dependencies.report(`Skipped Discord attachment. ${summary}`, 'warning')
}

async function reportFullQueue(
  message: Message,
  dependencies: DiscordInboundDependencies,
): Promise<void> {
  await message
    .reply({
      content: 'I am at capacity right now. Please try that again in a moment.',
      allowedMentions: { repliedUser: false },
    })
    .catch((error: unknown) => {
      dependencies.report(
        `Could not report a full Discord queue: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    })
}

function channelLabel(message: Message): string {
  if (!message.guild) return `DM with ${senderName(message)}`
  const name = ('name' in message.channel ? message.channel.name : null) ?? 'unknown-channel'
  return `${sanitizeDiscordLabel(message.guild.name)} #${sanitizeDiscordLabel(name)}`
}

export function appendEmbedContext(content: string, message: Message): string {
  const embeds = message.embeds
    .slice(0, 4)
    .map((embed) => {
      const title = sanitizeDiscordLabel(embed.title || '')
      const description = humanizeDiscordText(message, embed.description || '').trim()
      const url = embed.url?.trim() || ''
      return [title, description, url].filter(Boolean).join(' · ')
    })
    .filter(Boolean)
  if (embeds.length === 0) return content
  return [content, 'Discord embeds:', ...embeds.map((embed) => `- ${embed}`)]
    .filter(Boolean)
    .join('\n')
}
