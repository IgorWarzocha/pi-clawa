import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { CLAWAS_DELIVERY_MESSAGE_TYPE, CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.js'
import type { ClawasExtractedDelivery, ClawasExtractedMessage } from './types.js'

export interface ClawasExtractedUserMessage {
  content: string
  timestamp: number
}

function getTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as Record<string, unknown>)['type'] === 'text' &&
        typeof (part as Record<string, unknown>)['text'] === 'string',
    )
    .map((part) => part.text)
    .join('\n')
}

function messageContentHasToolCall(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'toolCall',
    )
  )
}

function getEntryTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return 0
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function getClawasMailDetails(entry: Record<string, unknown>): Record<string, unknown> | null {
  const customType = entry['customType']
  if (
    customType !== CLAWAS_MAIL_MESSAGE_TYPE &&
    customType !== 'clawas-session' &&
    customType !== 'clawas-report'
  ) {
    return null
  }

  if (entry['type'] === 'custom_message') {
    return getRecord(entry['details']) ?? {}
  }

  if (entry['type'] === 'custom') {
    const data = getRecord(entry['data'])
    return getRecord(data?.['details']) ?? {}
  }

  return null
}

export function getLastMailMessageDetails(
  ctx: ExtensionContext,
): Record<string, unknown> | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (!entry) continue
    const details = getClawasMailDetails(entry)
    if (!details) {
      continue
    }

    return details
  }

  return undefined
}

export function getLastAssistantMessage(ctx: ExtensionContext): ClawasExtractedMessage | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (entry?.['type'] !== 'message') {
      continue
    }

    const message = getRecord(entry['message'])
    if (message?.['role'] !== 'assistant') {
      continue
    }

    const text = getTextFromMessageContent(message['content']).trim()

    const stopReason = message['stopReason']
    const errorMessage = message['errorMessage']
    if (
      !text &&
      stopReason === 'error' &&
      typeof errorMessage === 'string' &&
      errorMessage.trim()
    ) {
      return {
        role: 'assistant',
        content: '',
        timestamp: getEntryTimestamp(message['timestamp']),
        error: errorMessage.trim(),
      }
    }

    if (!text) {
      continue
    }

    // Assistant messages that also contain tool calls are pre-tool narration,
    // not final Discord copy. The gateway may poll while those tool turns are
    // still running, so never expose them as deliverable public text.
    if (messageContentHasToolCall(message['content'])) {
      continue
    }

    return {
      role: 'assistant',
      content: text,
      timestamp: getEntryTimestamp(message['timestamp']),
    }
  }

  return undefined
}

export function getLastUserMessage(ctx: ExtensionContext): ClawasExtractedUserMessage | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (entry?.['type'] !== 'message') {
      continue
    }

    const message = getRecord(entry['message'])
    if (message?.['role'] !== 'user') {
      continue
    }

    const text = getTextFromMessageContent(message['content']).trim()
    if (!text) {
      continue
    }

    return {
      content: text,
      timestamp: getEntryTimestamp(message['timestamp']),
    }
  }

  return undefined
}

export function getLastDeliveryMessage(ctx: ExtensionContext): ClawasExtractedDelivery | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (entry?.['type'] !== 'custom_message') {
      continue
    }

    if (entry['customType'] !== CLAWAS_DELIVERY_MESSAGE_TYPE) {
      continue
    }

    const details =
      typeof entry['details'] === 'object' && entry['details'] !== null
        ? (entry['details'] as Record<string, unknown>)
        : null
    const route = details?.['route']
    if (route !== 'discord' && route !== 'main-claw') {
      continue
    }

    const text = getTextFromMessageContent(entry['content']).trim()
    if (!text) {
      continue
    }

    return {
      route,
      content: text,
      timestamp: getEntryTimestamp(entry['timestamp']),
    }
  }

  return undefined
}

export function getLastMailMessageTimestamp(ctx: ExtensionContext): number | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (!entry) continue
    if (!getClawasMailDetails(entry)) {
      continue
    }

    return getEntryTimestamp(entry['timestamp'])
  }

  return undefined
}

export function getLastDiscordSourceMessageId(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (!entry) continue
    const details = getClawasMailDetails(entry)
    if (!details) {
      continue
    }

    if (typeof details?.['sourceMessageId'] === 'string' && details['sourceMessageId'].trim()) {
      return details['sourceMessageId']
    }

    return undefined
  }

  return undefined
}

export function getLastDiscordChannelJid(ctx: ExtensionContext): string | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (!entry) continue
    const details = getClawasMailDetails(entry)
    if (!details) {
      continue
    }

    if (typeof details?.['channelJid'] === 'string' && details['channelJid'].trim()) {
      return details['channelJid']
    }

    return undefined
  }

  return undefined
}

export function getLastDiscordMessageHandles(
  ctx: ExtensionContext,
): Record<string, { channelJid: string; messageId: string }> | undefined {
  const branch = ctx.sessionManager.getBranch()

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = getRecord(branch[index])
    if (!entry) continue
    const details = getClawasMailDetails(entry)
    if (!details) {
      continue
    }

    const handles = getRecord(details['messageHandles'])
    if (!handles) return undefined

    const out: Record<string, { channelJid: string; messageId: string }> = {}
    for (const [label, value] of Object.entries(handles)) {
      const record = getRecord(value)
      if (typeof record?.['channelJid'] === 'string' && typeof record?.['messageId'] === 'string') {
        out[label.toLowerCase()] = {
          channelJid: record['channelJid'],
          messageId: record['messageId'],
        }
      }
    }

    return out
  }

  return undefined
}
