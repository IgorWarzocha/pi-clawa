import type { ChannelPolicy, DiscordConfig } from '../config.js'

export function canUseDiscordChannel(
  config: Pick<DiscordConfig, 'channelPolicy' | 'allowedChannelIds' | 'excludedChannelIds'>,
  channelId: string,
  isDm: boolean,
): boolean {
  if (isDm) return true
  if (config.excludedChannelIds.has(channelId)) return false
  if (config.channelPolicy === 'channels' || config.allowedChannelIds.size > 0) {
    return config.allowedChannelIds.has(channelId)
  }
  return true
}

export function shouldAcceptDiscordMessage(options: {
  isDm: boolean
  channelId: string
  channelPolicy: ChannelPolicy
  allowedChannelIds: ReadonlySet<string>
  excludedChannelIds: ReadonlySet<string>
  mentioned: boolean
  isReplyToBot: boolean
  content: string
  aliasPattern: RegExp | null
}): boolean {
  if (!canUseDiscordChannel(options, options.channelId, options.isDm)) return false
  if (options.isDm) return true
  if (options.channelPolicy === 'all') return true
  if (options.channelPolicy === 'channels') {
    return options.allowedChannelIds.has(options.channelId)
  }
  return (
    options.mentioned ||
    options.isReplyToBot ||
    Boolean(options.aliasPattern?.test(options.content))
  )
}

export function buildAliasPattern(aliases: string[]): RegExp | null {
  const escaped = aliases.map((alias) => escapeRegExp(alias.trim())).filter(Boolean)
  if (escaped.length === 0) return null
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'iu')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
