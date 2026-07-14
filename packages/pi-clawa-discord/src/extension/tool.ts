import { resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  getLastDiscordChannelJid,
  getLastDiscordMessageHandles,
  getLastDiscordSourceMessageId,
} from '@howaboua/pi-clawa/clawas/comms/message-extract'
import { publishClawasDeliveryMessage } from '@howaboua/pi-clawa/clawas/comms/outbound'
import { normalizeDiscordReplyText } from '@howaboua/pi-clawa/clawas/comms/report-back-helpers'
import { findRepoRoot } from '@howaboua/pi-clawa/config'
import { Type } from 'typebox'
import type {
  DiscordActionInput,
  DiscordFileInput,
  DiscordPollInput,
  DiscordSelectInput,
} from '../gateway/delivery-types.js'
import { DISCORD_CONFIG_RELATIVE } from './constants.js'

type DiscordToolContext = Parameters<Parameters<ExtensionAPI['registerTool']>[0]['execute']>[4]

interface DiscordToolParams {
  channel: string
  message?: string | undefined
  title?: string | undefined
  card?: boolean | undefined
  files?: DiscordFileInput[] | undefined
  actions?: DiscordActionInput[] | undefined
  select?: DiscordSelectInput | undefined
  poll?: DiscordPollInput | undefined
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
      'Send Discord text, images/files, rich cards, buttons, selects, polls, or reactions. Requires dm or an exact #channel route.',
    parameters: Type.Object({
      channel: Type.String({
        description: 'Destination: dm or #channel.',
      }),
      message: Type.Optional(Type.String({ description: 'Discord message to send.' })),
      title: Type.Optional(Type.String({ description: 'Optional heading for a rich result.' })),
      card: Type.Optional(
        Type.Boolean({ description: 'Render this as a modern Discord Components V2 card.' }),
      ),
      files: Type.Optional(
        Type.Array(
          Type.Object({
            path: Type.String({
              description: 'Local file path, absolute or relative to this Clawa.',
            }),
            description: Type.Optional(
              Type.String({ description: 'Accessible description or alt text.' }),
            ),
            spoiler: Type.Optional(Type.Boolean()),
          }),
          { maxItems: 10 },
        ),
      ),
      actions: Type.Optional(
        Type.Array(
          Type.Object({
            label: Type.String(),
            prompt: Type.Optional(
              Type.String({ description: 'Clawa turn produced when the button is clicked.' }),
            ),
            style: Type.Optional(
              Type.Union([
                Type.Literal('primary'),
                Type.Literal('secondary'),
                Type.Literal('success'),
                Type.Literal('danger'),
              ]),
            ),
            url: Type.Optional(Type.String({ description: 'Makes this a link button.' })),
            modal: Type.Optional(
              Type.Object({
                title: Type.String(),
                label: Type.String(),
                prompt: Type.Optional(Type.String()),
                placeholder: Type.Optional(Type.String()),
                required: Type.Optional(Type.Boolean()),
              }),
            ),
          }),
          { maxItems: 5 },
        ),
      ),
      select: Type.Optional(
        Type.Object({
          placeholder: Type.String(),
          options: Type.Array(
            Type.Object({
              label: Type.String(),
              prompt: Type.Optional(Type.String()),
              description: Type.Optional(Type.String()),
            }),
            { minItems: 1, maxItems: 25 },
          ),
          minValues: Type.Optional(Type.Integer()),
          maxValues: Type.Optional(Type.Integer()),
        }),
      ),
      poll: Type.Optional(
        Type.Object({
          question: Type.String(),
          answers: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }),
          durationHours: Type.Optional(Type.Integer()),
          allowMultiselect: Type.Optional(Type.Boolean()),
        }),
      ),
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
  const hasDelivery = Boolean(
    message ||
      params.title?.trim() ||
      (params.files?.length ?? 0) > 0 ||
      (params.actions?.length ?? 0) > 0 ||
      params.select ||
      params.poll ||
      react,
  )
  if (!hasDelivery) return buildDiscordToolResult(workerId, 'No public beat sent.')

  const channelJid = await resolveRequiredDiscordChannel(params.channel, workerId)
  const handleTarget = resolveReactionHandle(params.to, ctx)
  if (react && !handleTarget) throw new Error(buildMissingReactionHandleMessage(ctx))

  const sourceChannelJid = getLastDiscordChannelJid(ctx)
  const { queueDiscordDelivery } = await import('../gateway/discord/send.js')
  const result = await queueDiscordDelivery({
    channelJid,
    text: message || undefined,
    title: params.title?.trim() || undefined,
    card: params.card,
    replyToMessageId:
      sourceChannelJid === channelJid ? getLastDiscordSourceMessageId(ctx) : undefined,
    files: (params.files ?? []).map((file) => ({
      ...file,
      path: resolve(ctx.cwd, file.path),
    })),
    actions: params.actions,
    select: params.select,
    poll: params.poll,
    reaction:
      react && handleTarget
        ? {
            channelJid: handleTarget.channelJid,
            messageId: handleTarget.messageId,
            emoji: react,
          }
        : undefined,
  })

  publishClawasDeliveryMessage(pi, buildDeliveredText(params, message, react), {
    route: 'discord',
    workerId,
    workerTitle,
  })
  return {
    content: [
      {
        type: 'text' as const,
        text: result.messageId
          ? `Delivered to ${formatTargetLabel(params.channel)}.`
          : `Queued for ${formatTargetLabel(params.channel)}.`,
      },
    ],
    details: { workerId, messageId: result.messageId, sentFiles: result.sentFiles },
  }
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
  return [
    react && params.to ? `[react ${params.to}: ${react}]` : undefined,
    message,
    params.title ? `[Discord card: ${params.title}]` : undefined,
    (params.files?.length ?? 0) > 0 ? `[Discord files: ${params.files?.length}]` : undefined,
    (params.actions?.length ?? 0) > 0 ? `[Discord actions: ${params.actions?.length}]` : undefined,
    params.poll ? `[Discord poll: ${params.poll.question}]` : undefined,
  ]
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
