import { isAbsolute, resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getLastDiscordSourceMessageId } from '@howaboua/pi-claw/clawas/comms/message-extract'
import { publishClawasDeliveryMessage } from '@howaboua/pi-claw/clawas/comms/outbound'
import { normalizeDiscordReplyText } from '@howaboua/pi-claw/clawas/comms/report-back-helpers'
import { findRepoRoot } from '@howaboua/pi-claw/config'
import { Type } from 'typebox'
import { DISCORD_CONFIG_RELATIVE } from './constants.js'
import { readEnvFile } from './env-file.js'
import { getGatewayConfigPath, setGatewayConfigPath } from './gateway-state.js'

function resolveWorkerChannelJid(workerId: string): string | null {
  const configPath = getGatewayConfigPath()
  if (!configPath) return null
  const map = readEnvFile(configPath)['CLAWAS_CHANNEL_WORKERS'] ?? ''
  for (const entry of map
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const equals = entry.indexOf('=')
    if (equals === -1) continue
    const channel = entry.slice(0, equals).trim()
    const worker = entry.slice(equals + 1).trim()
    if (worker === workerId) return channel.startsWith('dc:') ? channel : `dc:${channel}`
  }
  return null
}

function prepareDiscordToolEnvironment(): void {
  const projectRoot = process.env['PI_CLAW_PROJECT_ROOT'] ?? findRepoRoot(process.cwd())
  const configuredGatewayPath = process.env['PIDG_CONFIG']?.trim()
  setGatewayConfigPath(
    configuredGatewayPath
      ? isAbsolute(configuredGatewayPath)
        ? configuredGatewayPath
        : resolve(projectRoot, configuredGatewayPath)
      : resolve(projectRoot, DISCORD_CONFIG_RELATIVE),
  )
  process.env['PIDG_CONFIG'] ??= DISCORD_CONFIG_RELATIVE
  process.env['PI_CLAW_PROJECT_ROOT'] ??= projectRoot
  process.env['PI_CWD'] ??= projectRoot
}

export function registerDiscordTool(pi: ExtensionAPI): void {
  if (process.env['PI_CLAWAS_DISCORD_ENABLED'] !== '1') return
  prepareDiscordToolEnvironment()

  pi.registerTool({
    name: 'message_discord',
    label: 'Message Discord',
    description:
      'Public Discord send lane. Use for explicit public sends, native replies, reactions, attachments, multi-send delivery, or public sends from private/control turns.',
    parameters: Type.Object({
      message: Type.String({ description: 'Public Discord message to send.' }),
      replyToMessageId: Type.Optional(
        Type.String({ description: 'Optional Discord message id to reply to.' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const workerId = process.env['PI_CLAWAS_WORKER_ID']?.trim()
      const workerTitle = process.env['PI_CLAWAS_WORKER_TITLE']?.trim() || workerId || 'worker'
      const message = normalizeDiscordReplyText(params.message)
      if (!workerId) throw new Error('PI_CLAWAS_WORKER_ID is missing')
      if (!message)
        return {
          content: [{ type: 'text', text: 'No public Discord beat sent.' }],
          details: { workerId },
        }

      const channelJid = resolveWorkerChannelJid(workerId)
      if (!channelJid)
        throw new Error(`No Discord channel mapping found for Clawas worker ${workerId}`)

      const replyToMessageId =
        typeof params.replyToMessageId === 'string' && params.replyToMessageId.trim()
          ? params.replyToMessageId.trim()
          : getLastDiscordSourceMessageId(ctx)
      const { sendFilesToDiscord } = await import('../gateway/discord/send.js')
      await sendFilesToDiscord({ channelJid, text: message, replyToMessageId, files: [] })
      publishClawasDeliveryMessage(pi, message, { route: 'discord', workerId, workerTitle })
      return {
        content: [{ type: 'text', text: 'Sent public Discord beat.' }],
        details: { workerId },
      }
    },
  })
}
