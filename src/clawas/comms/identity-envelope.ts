import type {
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasSenderInfo,
} from './types.js'

const MAIL_ENVELOPE_START = '[[CLAWAS_MAIL]]'
const MAIL_ENVELOPE_END = '[[/CLAWAS_MAIL]]'
const LEGACY_ENVELOPE_START = '[[CLAWAS_SENDER]]'
const LEGACY_ENVELOPE_END = '[[/CLAWAS_SENDER]]'
const SENDER_BANNER_PREFIX = 'FROM CLAWAS:'
const LEADING_SPACE_REGEX = /^\s+/
const SENDER_BANNER_REGEX = /^FROM CLAWAS:[^\n]*\n+/

interface ClawasMailEnvelopeOptions {
  sender?: ClawasSenderInfo
  kind?: ClawasMessageKind
  intent?: ClawasMessageIntent
  visibility?: ClawasMessageVisibility
}

function buildEnvelopeLines(options: ClawasMailEnvelopeOptions): string[] {
  const lines = [MAIL_ENVELOPE_START]
  if (options.sender?.workerId) {
    lines.push(`senderWorkerId: ${options.sender.workerId}`)
  }
  if (options.sender?.workerTitle) {
    lines.push(`senderWorkerTitle: ${options.sender.workerTitle}`)
  }
  if (options.kind) {
    lines.push(`kind: ${options.kind}`)
  }
  if (options.intent) {
    lines.push(`intent: ${options.intent}`)
  }
  if (options.visibility) {
    lines.push(`visibility: ${options.visibility}`)
  }
  lines.push(MAIL_ENVELOPE_END)
  return lines
}

function buildSenderBanner(options: ClawasMailEnvelopeOptions): string {
  const title = options.sender?.workerTitle?.trim() || options.sender?.workerId?.trim() || 'unknown'
  const workerId = options.sender?.workerId?.trim()
  const workerIdSuffix = workerId && workerId !== title ? ` (workerId: ${workerId})` : ''
  const kindLabel = options.kind ? ` · ${options.kind}` : ''
  return `${SENDER_BANNER_PREFIX} ${title}${workerIdSuffix}${kindLabel}`
}

export function wrapClawasMessageForLlm(
  message: string,
  options?: ClawasMailEnvelopeOptions,
): string {
  if (
    !(
      options?.sender?.workerId ||
      options?.sender?.workerTitle ||
      options?.kind ||
      options?.intent ||
      options?.visibility
    )
  ) {
    return message
  }

  if (message.startsWith(MAIL_ENVELOPE_START) || message.startsWith(LEGACY_ENVELOPE_START)) {
    return message
  }

  return `${buildEnvelopeLines(options).join('\n')}\n\n${buildSenderBanner(options)}\n\n${message}`
}

export function stripClawasMessageEnvelope(message: string): string {
  if (message.startsWith(MAIL_ENVELOPE_START)) {
    const endIndex = message.indexOf(MAIL_ENVELOPE_END)
    if (endIndex === -1) {
      return message
    }

    const stripped = message
      .slice(endIndex + MAIL_ENVELOPE_END.length)
      .replace(LEADING_SPACE_REGEX, '')
    return stripped.replace(SENDER_BANNER_REGEX, '')
  }

  if (!message.startsWith(LEGACY_ENVELOPE_START)) {
    return message
  }

  const endIndex = message.indexOf(LEGACY_ENVELOPE_END)
  if (endIndex === -1) {
    return message
  }

  const stripped = message
    .slice(endIndex + LEGACY_ENVELOPE_END.length)
    .replace(LEADING_SPACE_REGEX, '')
  return stripped.replace(SENDER_BANNER_REGEX, '')
}
