import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getLastDiscordMessageHandles } from '@howaboua/pi-clawa/clawas/comms/message-extract'
import { publishClawasDeliveryMessage } from '@howaboua/pi-clawa/clawas/comms/outbound'
import { normalizeDiscordReplyText } from '@howaboua/pi-clawa/clawas/comms/report-back-helpers'
import { findRepoRoot } from '@howaboua/pi-clawa/config'
import { Type } from 'typebox'
import { DISCORD_CONFIG_RELATIVE } from './constants.js'

type DiscordToolContext = Parameters<Parameters<ExtensionAPI['registerTool']>[0]['execute']>[4]

interface DiscordToolParams {
  channel: string
  message?: string | undefined
  react?: string | undefined
  to?: string | undefined
}

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
        Type.String({ description: 'Emoji reaction for a shown message handle.' }),
      ),
      to: Type.Optional(Type.String({ description: 'Message handle to react to, e.g. m1.' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return await executeDiscordMessageTool(pi, params, ctx)
    },
  })
}

async function executeDiscordMessageTool(
  pi: ExtensionAPI,
  params: DiscordToolParams,
  ctx: DiscordToolContext,
) {
  const workerId = process.env['PI_CLAWAS_WORKER_ID']?.trim()
  const workerTitle = process.env['PI_CLAWAS_WORKER_TITLE']?.trim() || workerId || 'worker'
  const message = normalizeDiscordReplyText(params.message)
  const react = params.react?.trim()
  if (!workerId) throw new Error('PI_CLAWAS_WORKER_ID is missing')
  if (!(message || react)) return buildDiscordToolResult(workerId, 'No public beat sent.')

  const channelJid = await resolveRequiredDiscordChannel(params.channel, workerId)
  const handleTarget = resolveReactionHandle(params.to, ctx)
  if (react && !handleTarget) throw new Error(buildMissingReactionHandleMessage(ctx))

  const { sendFilesToDiscord } = await import('../gateway/discord/send.js')
  await sendFilesToDiscord({
    channelJid,
    text: message || undefined,
    reaction:
      react && handleTarget
        ? {
            channelJid: handleTarget.channelJid,
            messageId: handleTarget.messageId,
            emoji: react,
          }
        : undefined,
    files: [],
  })

  publishClawasDeliveryMessage(pi, buildDeliveredText(params, message, react), {
    route: 'discord',
    workerId,
    workerTitle,
  })
  return buildDiscordToolResult(workerId, `Delivered to ${formatTargetLabel(params.channel)}.`)
}

function buildDiscordToolResult(workerId: string, text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    details: { workerId },
  }
}

function buildDeliveredText(
  params: DiscordToolParams,
  message: string | null | undefined,
  react: string | undefined,
): string {
  return [react && params.to ? `[react ${params.to}: ${react}]` : undefined, message]
    .filter(Boolean)
    .join('\n')
}

function formatTargetLabel(channel: string): string {
  return channel.trim().toLowerCase() === 'dm' ? '[dm]' : `[${channel}]`
}

function resolveReactionHandle(
  handle: string | undefined,
  ctx: DiscordToolContext,
): { channelJid: string; messageId: string } | undefined {
  const label = handle?.trim().toLowerCase()
  if (!label) return undefined
  return getLastDiscordMessageHandles(ctx)?.[label]
}

function buildMissingReactionHandleMessage(ctx: DiscordToolContext): string {
  const handles = Object.keys(getLastDiscordMessageHandles(ctx) ?? {})
  const available = handles.length > 0 ? handles.join(', ') : 'none'
  return `Cannot react without a valid message handle. Available handles: ${available}.`
}
