export const NOTHING_FOR_DISCORD_SENTINEL = '[quiet]'
const STANDALONE_CLAWAS_DIRECTIVE_REGEX = /^\[CLAWAS\]\s*(?:\n+([\s\S]*))?$/i
const INLINE_CLAWAS_DIRECTIVE_REGEX = /^\[CLAWAS\]\s+([\s\S]+)$/i
const QUIET_DIRECTIVE_REGEX = /^\[quiet\]:?$/i
const REACTION_DIRECTIVE_REGEX = /^\[react\s+m\d+:\s*.+?\]$/i
const LINE_SPLIT_REGEX = /\r?\n/u

export interface DiscordRelayCandidate {
  content: string
  timestamp?: number | undefined
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

  const withStandaloneDirective = trimmed.match(STANDALONE_CLAWAS_DIRECTIVE_REGEX)
  if (withStandaloneDirective) {
    return (withStandaloneDirective[1] ?? '').trim()
  }

  const withInlineDirective = trimmed.match(INLINE_CLAWAS_DIRECTIVE_REGEX)
  if (withInlineDirective) {
    return (withInlineDirective[1] ?? '').trim()
  }

  return null
}

export function normalizeDiscordReplyText(content: string | null | undefined): string | null {
  const trimmed = content?.trim()
  if (!trimmed) {
    return null
  }

  if (isQuietOnlyDiscordFinal(trimmed)) {
    return null
  }

  return trimmed
}

function isQuietOnlyDiscordFinal(content: string): boolean {
  const meaningfulLines = content
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !REACTION_DIRECTIVE_REGEX.test(line))
  return meaningfulLines.length === 1 && QUIET_DIRECTIVE_REGEX.test(meaningfulLines[0] ?? '')
}

export function shouldSkipAutoDiscordRelay(options: {
  message: DiscordRelayCandidate
  lastDelivery?: LastDiscordDelivery | undefined
}): boolean {
  const { message, lastDelivery } = options
  if (lastDelivery?.route !== 'discord') {
    return false
  }

  const messageTimestamp = message.timestamp ?? 0
  return lastDelivery.timestamp >= messageTimestamp
}

export function shouldSkipAutoMainClawStatusRelay(options: {
  lastDelivery?: LastDiscordDelivery | undefined
  lastMailTimestamp?: number | undefined
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
  lastMailDetails?: Record<string, unknown> | undefined
  messageTimestamp?: number | undefined
  lastMailTimestamp?: number | undefined
}): boolean {
  if (normalizeDiscordReplyText(options.messageContent) === null) {
    return false
  }

  if (isHydrationPreloadText(options.messageContent)) {
    return false
  }

  if (
    options.lastMailDetails?.['intent'] === 'for_context' &&
    options.messageTimestamp !== undefined &&
    options.lastMailTimestamp !== undefined &&
    options.lastMailTimestamp >= options.messageTimestamp
  ) {
    return false
  }

  return true
}
