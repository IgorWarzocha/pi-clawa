import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  getLastDiscordChannelJid,
  getLastDiscordSourceMessageId,
} from '@howaboua/pi-clawa/clawas/comms/message-extract'
import { publishClawasDeliveryMessage } from '@howaboua/pi-clawa/clawas/comms/outbound'
import { normalizeDiscordReplyText } from '@howaboua/pi-clawa/clawas/comms/report-back-helpers'
import { findRepoRoot } from '@howaboua/pi-clawa/config'
import { Type } from 'typebox'
import { DISCORD_CONFIG_RELATIVE } from './constants.js'

function prepareDiscordToolEnvironment(): void {
  const projectRoot = process.env['PI_CLAW_PROJECT_ROOT'] ?? findRepoRoot(process.cwd())
  process.env['PI_CLAWA_DISCORD_CONFIG'] ??= DISCORD_CONFIG_RELATIVE
  process.env['PI_CLAW_PROJECT_ROOT'] ??= projectRoot
  process.env['PI_CWD'] ??= projectRoot
}

function formatAvailableDiscordChannels(routeTags: string[]): string {
  const channels = routeTags.filter((tag) => tag === '[dm]' || tag.startsWith('[#'))
  return channels.join(', ') || 'none configured'
}

async function resolveRequiredDiscordChannel(channel: string, workerId: string): Promise<string> {
  const { initDb } = await import('../gateway/db.js')
  initDb()
  const { resolveDiscordChannelLabel } = await import('../gateway/agent/final-routes.js')
  const { listDiscordRouteTags } = await import('../gateway/channel-routes.js')
  const channelJid = resolveDiscordChannelLabel(channel, workerId)
  if (channelJid) return channelJid

  const available = formatAvailableDiscordChannels(listDiscordRouteTags(workerId))
  throw new Error(`Unknown Discord channel: ${channel}. Available Discord channels: ${available}.`)
}

export function registerDiscordTool(pi: ExtensionAPI): void {
  if (process.env['PI_CLAWAS_DISCORD_ENABLED'] !== '1') return
  prepareDiscordToolEnvironment()

  pi.registerTool({
    name: 'message_discord',
    label: 'Message Discord',
    description:
      'Explicit Discord send lane. Requires a destination: dm or #channel. Use for sends/reactions outside final routing blocks.',
    parameters: Type.Object({
      channel: Type.String({
        description: 'Destination: dm or #channel.',
      }),
      message: Type.Optional(Type.String({ description: 'Discord message to send.' })),
      react: Type.Optional(
        Type.String({ description: 'Emoji reaction for the current source Discord message.' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const workerId = process.env['PI_CLAWAS_WORKER_ID']?.trim()
      const workerTitle = process.env['PI_CLAWAS_WORKER_TITLE']?.trim() || workerId || 'worker'
      const message = normalizeDiscordReplyText(params.message)
      const react = params.react?.trim()
      if (!workerId) throw new Error('PI_CLAWAS_WORKER_ID is missing')
      if (!(message || react))
        return {
          content: [{ type: 'text', text: 'No public Discord beat sent.' }],
          details: { workerId },
        }

      const channelJid = await resolveRequiredDiscordChannel(params.channel, workerId)

      const sourceChannelJid = getLastDiscordChannelJid(ctx)
      const replyToMessageId =
        channelJid === sourceChannelJid ? getLastDiscordSourceMessageId(ctx) : undefined
      if (react && !replyToMessageId) {
        throw new Error('Cannot react: no source Discord message is attached for that channel.')
      }

      const { sendFilesToDiscord } = await import('../gateway/discord/send.js')
      const text = [react ? `[React: ${react}]` : undefined, message].filter(Boolean).join('\n')
      await sendFilesToDiscord({ channelJid, text, replyToMessageId, files: [] })
      publishClawasDeliveryMessage(pi, text, { route: 'discord', workerId, workerTitle })
      return {
        content: [{ type: 'text', text: 'Sent public Discord beat.' }],
        details: { workerId },
      }
    },
  })
}
