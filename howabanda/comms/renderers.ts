import { getMarkdownTheme, type MessageRenderer } from '@earendil-works/pi-coding-agent'
import { Box, Markdown, Spacer, Text } from '@earendil-works/pi-tui'
import type { BurrowDefaults } from '../../config'
import { stripHowabandaMessageEnvelope } from './identity-envelope.js'
import { HOWABANDA_MAIL_MESSAGE_TYPE, HOWABANDA_OUTBOUND_MESSAGE_TYPE } from './outbound.js'

function getSpeakerTitle(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }

  if ('workerTitle' in details && typeof details.workerTitle === 'string') {
    return details.workerTitle
  }
  if ('workerId' in details && typeof details.workerId === 'string') {
    return details.workerId
  }
  return undefined
}

function getOutboundMode(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }

  if ('mode' in details && typeof details.mode === 'string') {
    return details.mode === 'followUp' ? 'follow-up' : details.mode
  }

  return undefined
}

function getMailDetail(
  details: unknown,
  key: 'kind' | 'intent' | 'visibility',
): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }

  if (key in details && typeof details[key] === 'string') {
    return details[key]
  }

  return undefined
}

function getSourceTitle(details: unknown, burrowDefaults: BurrowDefaults): string {
  if (
    details &&
    typeof details === 'object' &&
    'sourceTitle' in details &&
    typeof details.sourceTitle === 'string'
  ) {
    return details.sourceTitle
  }

  return burrowDefaults.mainClawName
}

function renderLabel(
  customType: string,
  details: unknown,
  theme: Parameters<MessageRenderer>[2],
  burrowDefaults: BurrowDefaults,
): string {
  const speaker = getSpeakerTitle(details)

  if (customType === 'howabanda-session') {
    const title = speaker ?? burrowDefaults.mainClawName
    return theme.fg('customMessageLabel', `Message from ${title}`)
  }

  if (customType === 'howabanda-report') {
    const title = speaker ?? 'the banda'
    return theme.fg('customMessageLabel', `Reply from ${title}`)
  }

  if (customType === HOWABANDA_MAIL_MESSAGE_TYPE) {
    const title = speaker ?? 'the banda'
    const kind = getMailDetail(details, 'kind')
    const visibility = getMailDetail(details, 'visibility')
    const bits = [kind, visibility].filter(Boolean).join(' · ')
    return theme.fg('customMessageLabel', `HOWABANDA mail from ${title}${bits ? ` · ${bits}` : ''}`)
  }

  if (customType === HOWABANDA_OUTBOUND_MESSAGE_TYPE) {
    const source = getSourceTitle(details, burrowDefaults)
    const target = speaker ?? 'worker'
    const mode = getOutboundMode(details)
    return theme.fg(
      'customMessageLabel',
      `Outgoing ${source} → ${target}${mode ? ` · ${mode}` : ''}`,
    )
  }

  return theme.fg('customMessageLabel', `[${customType}]`)
}

export function createHowabandaCommsRenderer(
  getBurrowDefaults: () => BurrowDefaults,
): MessageRenderer {
  return (message, _options, theme) => {
    const rawText = typeof message.content === 'string' ? message.content : ''
    const text = stripHowabandaMessageEnvelope(rawText)
    const burrowDefaults = getBurrowDefaults()
    const box = new Box(1, 1, (value) => theme.bg('customMessageBg', value))
    box.addChild(
      new Text(renderLabel(message.customType, message.details, theme, burrowDefaults), 0, 0),
    )
    box.addChild(new Spacer(1))
    box.addChild(
      new Markdown(text || '(no content)', 0, 0, getMarkdownTheme(), {
        color: (value: string) => theme.fg('customMessageText', value),
      }),
    )
    return box
  }
}
