import { getMarkdownTheme, type MessageRenderer } from '@earendil-works/pi-coding-agent'
import { Box, Markdown, Spacer, Text } from '@earendil-works/pi-tui'
import type { ClawaDefaults } from '../../config'
import { stripClawasMessageEnvelope } from './identity-envelope.js'
import { CLAWAS_MAIL_MESSAGE_TYPE, CLAWAS_OUTBOUND_MESSAGE_TYPE } from './outbound.js'

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
  const rec = details as Record<string, unknown>

  if (typeof rec[key] === 'string') {
    return rec[key]
  }

  return undefined
}

function getOutboundMessage(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }

  if ('message' in details && typeof details.message === 'string') {
    return details.message
  }

  return undefined
}

function getRawMailContent(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') {
    return undefined
  }

  if ('rawContent' in details && typeof details.rawContent === 'string') {
    return details.rawContent
  }

  return undefined
}

function getSourceTitle(details: unknown, clawaDefaults: ClawaDefaults): string {
  if (
    details &&
    typeof details === 'object' &&
    'sourceTitle' in details &&
    typeof details.sourceTitle === 'string'
  ) {
    return details.sourceTitle
  }

  return clawaDefaults.mainClawName
}

function renderLabel(
  customType: string,
  details: unknown,
  theme: Parameters<MessageRenderer>[2],
  clawaDefaults: ClawaDefaults,
): string {
  const speaker = getSpeakerTitle(details)

  if (customType === 'clawas-session') {
    const title = speaker ?? clawaDefaults.mainClawName
    return theme.fg('customMessageLabel', `Message from ${title}`)
  }

  if (customType === 'clawas-report') {
    const title = speaker ?? 'the Clawas'
    return theme.fg('customMessageLabel', `Reply from ${title}`)
  }

  if (customType === CLAWAS_MAIL_MESSAGE_TYPE) {
    const title = speaker ?? 'the Clawas'
    const kind = getMailDetail(details, 'kind')
    const visibility = getMailDetail(details, 'visibility')
    const bits = [kind, visibility].filter(Boolean).join(' · ')
    return theme.fg('customMessageLabel', `Clawas mail from ${title}${bits ? ` · ${bits}` : ''}`)
  }

  if (customType === CLAWAS_OUTBOUND_MESSAGE_TYPE) {
    const source = getSourceTitle(details, clawaDefaults)
    const target = speaker ?? 'worker'
    const mode = getOutboundMode(details)
    return theme.fg(
      'customMessageLabel',
      `Outgoing ${source} → ${target}${mode ? ` · ${mode}` : ''}`,
    )
  }

  return theme.fg('customMessageLabel', `[${customType}]`)
}

export function createClawasCommsRenderer(getClawaDefaults: () => ClawaDefaults): MessageRenderer {
  return (message, _options, theme) => {
    const rawText = typeof message.content === 'string' ? message.content : ''
    const outboundText =
      message.customType === CLAWAS_OUTBOUND_MESSAGE_TYPE
        ? getOutboundMessage(message.details)
        : undefined
    const text = stripClawasMessageEnvelope(
      outboundText ?? getRawMailContent(message.details) ?? rawText,
    )
    const clawaDefaults = getClawaDefaults()
    const box = new Box(1, 1, (value) => theme.bg('customMessageBg', value))
    box.addChild(
      new Text(renderLabel(message.customType, message.details, theme, clawaDefaults), 0, 0),
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
