const MAIL_ENVELOPE_START = '[[CLAWAS_MAIL]]'
const MAIL_ENVELOPE_END = '[[/CLAWAS_MAIL]]'
const LEGACY_ENVELOPE_START = '[[CLAWAS_SENDER]]'
const LEGACY_ENVELOPE_END = '[[/CLAWAS_SENDER]]'
const LEADING_SPACE_REGEX = /^\s+/
const SENDER_BANNER_REGEX = /^FROM CLAWAS:[^\n]*\n+/

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
