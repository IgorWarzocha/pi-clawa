export const NOTHING_FOR_DISCORD_SENTINEL = '[nothing_for_discord]'

export interface DiscordRelayCandidate {
  content: string
  timestamp?: number
}

export interface LastDiscordDelivery {
  route: 'discord' | 'main-claw'
  content: string
  timestamp: number
}

export function extractClawaReportText(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const withStandaloneDirective = trimmed.match(/^\[CLAWAS\]\s*(?:\n+([\s\S]*))?$/i)
  if (withStandaloneDirective) {
    return (withStandaloneDirective[1] ?? '').trim()
  }

  const withInlineDirective = trimmed.match(/^\[CLAWAS\]\s+([\s\S]+)$/i)
  if (withInlineDirective) {
    return withInlineDirective[1].trim()
  }

  return null
}

export function shouldAutoRelayFinalAssistantToDiscord(_options?: {
  workerId?: string
  discordEnabled?: string
}): boolean {
  return false
}

export function normalizeDiscordReplyText(content: string | null | undefined): string | null {
  const trimmed = content?.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.toLowerCase().includes(NOTHING_FOR_DISCORD_SENTINEL)) {
    return null
  }

  return trimmed
}

export function shouldSkipAutoDiscordRelay(options: {
  message: DiscordRelayCandidate
  lastDelivery?: LastDiscordDelivery
}): boolean {
  const { message, lastDelivery } = options
  if (lastDelivery?.route !== 'discord') {
    return false
  }

  const messageTimestamp = message.timestamp ?? 0
  return lastDelivery.timestamp >= messageTimestamp
}

export function shouldSkipAutoMainClawStatusRelay(options: {
  lastDelivery?: LastDiscordDelivery
  lastMailTimestamp?: number
}): boolean {
  const { lastDelivery, lastMailTimestamp } = options
  if (lastDelivery?.route !== 'main-claw') {
    return false
  }

  // If the worker already used message_main_claw after the current incoming
  // Clawas mail arrived, the final assistant text is only local closure.
  // Do not mirror it as a second report/status into main-claw.
  return lastDelivery.timestamp >= (lastMailTimestamp ?? 0)
}

export function isHydrationPreloadText(content: string | null | undefined): boolean {
  const trimmed = content?.trim()
  return Boolean(trimmed?.startsWith('## Claw Continuity Refresh (auto-loaded)'))
}

export function shouldReportClawaFinalToMain(options: {
  messageContent: string
  lastMailDetails?: Record<string, unknown>
}): boolean {
  if (isHydrationPreloadText(options.messageContent)) {
    return false
  }

  if (options.lastMailDetails?.intent === 'for_context') {
    return false
  }

  return true
}
