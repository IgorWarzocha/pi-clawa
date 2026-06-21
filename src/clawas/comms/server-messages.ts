import type {
  ClawasDiscordContext,
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasSendCommand,
  ClawasSenderInfo,
} from './types.js'

export const LEGACY_SESSION_MESSAGE_TYPE = 'clawas-session'
export const LEGACY_REPORT_MESSAGE_TYPE = 'clawas-report'

const OBSERVED_MESSAGES_START = 'Recent channel context:'
const OBSERVED_MESSAGES_END = 'End recent channel context.'
const AMBIENT_TRIGGER_PREFIX = 'Ambient check:'
const TIME_NOTE_PREFIX = '[Time note:'
const LINE_SPLIT_REGEX = /\r?\n/
const TIME_NOTE_REGEX = /^\[Time note:\s*(.*?)\.\]$/

export function resolveMessageKind(command: ClawasSendCommand): ClawasMessageKind {
  if (command.kind) {
    return command.kind
  }

  if (command.messageType === 'report') {
    return 'report'
  }

  return 'mail'
}

export function resolveMessageIntent(
  command: ClawasSendCommand,
  kind: ClawasMessageKind,
): ClawasMessageIntent {
  if (command.intent) {
    return command.intent
  }

  if (kind === 'report') {
    return 'status'
  }

  return 'reply_requested'
}

export function resolveMessageVisibility(
  command: ClawasSendCommand,
  kind: ClawasMessageKind,
): ClawasMessageVisibility {
  if (command.visibility) {
    return command.visibility
  }

  if (kind === 'report') {
    return 'private'
  }

  return 'worker'
}

export function buildMessageDetails(
  sender: ClawasSenderInfo | undefined,
  discordContext: ClawasDiscordContext | undefined,
  kind: ClawasMessageKind,
  intent: ClawasMessageIntent,
  visibility: ClawasMessageVisibility,
) {
  return {
    workerId: sender?.workerId,
    workerTitle: sender?.workerTitle,
    sourceMessageId: discordContext?.sourceMessageId,
    channelJid: discordContext?.channelJid,
    kind,
    intent,
    visibility,
  }
}

function splitDiscordGatewayPrompt(message: string): {
  currentTrigger: string
  recentContext?: string | undefined
} {
  const lines = message.split(LINE_SPLIT_REGEX)
  const kept: string[] = []
  const observed: string[] = []
  let inObserved = false

  for (const line of lines) {
    if (line.startsWith(TIME_NOTE_PREFIX)) {
      kept.push(line.replace(TIME_NOTE_REGEX, 'Time: $1.'))
      continue
    }

    if (line.startsWith(OBSERVED_MESSAGES_START)) {
      inObserved = true
      continue
    }

    if (inObserved) {
      if (line.trim() === OBSERVED_MESSAGES_END) {
        inObserved = false
        continue
      }
      observed.push(line)
      continue
    }

    kept.push(line)
  }

  return {
    currentTrigger: kept.join('\n').trim(),
    recentContext: observed.join('\n').trim() || undefined,
  }
}

export function buildWorkerUserMessage(
  message: string,
  details: ReturnType<typeof buildMessageDetails>,
): string {
  if (details.workerId === 'discord-gateway') {
    const { currentTrigger, recentContext } = splitDiscordGatewayPrompt(message)
    const trigger = currentTrigger.trim()
    return [
      currentTrigger.includes(AMBIENT_TRIGGER_PREFIX)
        ? '[Discord room update — ambient]'
        : '[Discord room update]',
      'This is recent activity from the mapped Discord channel. It is not all from Igor, and not every line is an instruction for you.',
      recentContext ? `Recent channel context:\n${recentContext}` : null,
      `Current trigger:\n${trigger || message}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n\n')
  }

  const title = details.workerTitle || details.workerId || 'unknown'
  return [
    '[Clawas worker update]',
    `Source: ${title}`,
    `Kind: ${details.kind}; intent: ${details.intent}; visibility: ${details.visibility}`,
    'This is a Clawas coordination message, not direct speech from Igor unless the content says so.',
    'Current trigger:',
    message,
  ].join('\n')
}

export function shouldDeliverClawasMailAsUserMessage(
  details: ReturnType<typeof buildMessageDetails>,
): boolean {
  return details.workerId === 'discord-gateway' && details.kind !== 'instruction'
}

export function getLegacyMailCustomType(command: ClawasSendCommand): string {
  return command.messageType === 'report' ? LEGACY_REPORT_MESSAGE_TYPE : LEGACY_SESSION_MESSAGE_TYPE
}

export function shouldTriggerTurn(command: ClawasSendCommand): boolean {
  return command.intent !== 'for_context'
}

export function shouldAllowManualSessionSend(command: ClawasSendCommand): boolean {
  return command.mode === 'followUp' && command.kind === 'instruction'
}
