import type { Message } from 'discord.js'

const DANGEROUS_INVISIBLE = /[\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu
const LINE_BREAKS = /\r\n?|[\u2028\u2029]/gu
const LABEL_WHITESPACE = /\s+/gu
const USER_MENTION = /<@!?(\d+)>/gu
const ROLE_MENTION = /<@&(\d+)>/gu
const CHANNEL_MENTION = /<#(\d+)>/gu

export function sanitizeDiscordText(input: string): string {
  return stripControls(
    input.normalize('NFC').replace(LINE_BREAKS, '\n').replace(DANGEROUS_INVISIBLE, ''),
  )
}

function stripControls(input: string): string {
  let output = ''
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0
    const control =
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      (code >= 127 && code <= 159)
    if (!control) output += character
  }
  return output
}

export function sanitizeDiscordLabel(input: string): string {
  return sanitizeDiscordText(input).replace(LABEL_WHITESPACE, ' ').trim()
}

export function humanizeDiscordText(message: Message, input: string): string {
  return sanitizeDiscordText(input)
    .replace(USER_MENTION, (_source, id: string) => {
      const member = message.mentions.members?.get(id) ?? message.guild?.members.cache.get(id)
      const user = message.mentions.users.get(id) ?? message.client.users.cache.get(id)
      const name = sanitizeDiscordLabel(
        member?.displayName || user?.displayName || user?.username || '',
      )
      return name ? `@${name}` : '@unknown-user'
    })
    .replace(ROLE_MENTION, (_source, id: string) => {
      const name = sanitizeDiscordLabel(message.mentions.roles.get(id)?.name || '')
      return name ? `@${name}` : '@unknown-role'
    })
    .replace(CHANNEL_MENTION, (_source, id: string) => {
      const channel = message.mentions.channels.get(id)
      const name = channel && 'name' in channel ? sanitizeDiscordLabel(channel.name ?? '') : ''
      return name ? `#${name}` : '#unknown-channel'
    })
}
