import type {
  ClawasCommsCommand,
  ClawasCommsResponse,
  ClawasDiscordContext,
  ClawasExtractedMessage,
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasSenderInfo,
  ClawasSessionStatus,
} from './types.js'

type ParseResult<T> = { value: T } | { error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`)
  }
  return value
}

function optionalEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  values: T,
): T[number] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}`)
  }
  return value
}

function parseSender(value: unknown): ClawasSenderInfo | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('sender must be an object')
  return {
    workerId: optionalString(value, 'workerId'),
    workerTitle: optionalString(value, 'workerTitle'),
  }
}

function parseMessageHandles(value: unknown): ClawasDiscordContext['messageHandles'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('messageHandles must be an object')
  const messageHandles: NonNullable<ClawasDiscordContext['messageHandles']> = {}
  for (const [label, rawHandle] of Object.entries(value)) {
    if (!isRecord(rawHandle)) throw new Error(`messageHandles.${label} must be an object`)
    const channelJid = optionalString(rawHandle, 'channelJid')
    const messageId = optionalString(rawHandle, 'messageId')
    if (!(channelJid && messageId)) {
      throw new Error(`messageHandles.${label} requires channelJid and messageId`)
    }
    messageHandles[label] = { channelJid, messageId }
  }
  return messageHandles
}

function parseDiscordContext(value: unknown): ClawasDiscordContext | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('discordContext must be an object')
  const queueRowId = optionalFiniteNumber(value, 'queueRowId')
  if (queueRowId !== undefined && !Number.isSafeInteger(queueRowId)) {
    throw new Error('queueRowId must be an integer')
  }

  return {
    sourceMessageId: optionalString(value, 'sourceMessageId'),
    channelJid: optionalString(value, 'channelJid'),
    queueRowId,
    messageHandles: parseMessageHandles(value['messageHandles']),
  }
}

export function parseClawasCommsCommand(value: unknown): ParseResult<ClawasCommsCommand> {
  try {
    if (!isRecord(value)) throw new Error('command must be an object')
    const id = optionalString(value, 'id')
    if (value['type'] === 'get_status') return { value: { type: 'get_status', id } }
    if (value['type'] === 'subscribe_status') return { value: { type: 'subscribe_status', id } }
    if (value['type'] === 'get_message') {
      return {
        value: {
          type: 'get_message',
          id,
          afterTimestamp: optionalFiniteNumber(value, 'afterTimestamp'),
          afterContent: optionalString(value, 'afterContent'),
        },
      }
    }
    if (value['type'] !== 'send') throw new Error('unsupported command type')

    const message = optionalString(value, 'message')
    if (!message?.trim()) throw new Error('send.message must be a non-empty string')
    return {
      value: {
        type: 'send',
        id,
        message,
        mode: optionalEnum(value, 'mode', ['steer', 'followUp'] as const),
        messageType: optionalEnum(value, 'messageType', ['session', 'report'] as const),
        discordContext: parseDiscordContext(value['discordContext']),
        sender: parseSender(value['sender']),
        kind: optionalEnum(value, 'kind', [
          'mail',
          'report',
          'coordination',
          'relay',
          'instruction',
        ] as const) as ClawasMessageKind | undefined,
        intent: optionalEnum(value, 'intent', [
          'reply_requested',
          'for_context',
          'handoff',
          'status',
        ] as const) as ClawasMessageIntent | undefined,
        visibility: optionalEnum(value, 'visibility', [
          'worker',
          'main-claw',
          'private',
        ] as const) as ClawasMessageVisibility | undefined,
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function parseLastMessageData(value: unknown): ClawasExtractedMessage | null {
  if (!isRecord(value)) throw new Error('get_message response data must be an object')
  const message = value['message']
  if (message === null) return null
  if (!isRecord(message)) throw new Error('get_message response requires message or null')
  if (
    message['role'] !== 'assistant' ||
    typeof message['content'] !== 'string' ||
    typeof message['timestamp'] !== 'number' ||
    !Number.isFinite(message['timestamp']) ||
    (message['error'] !== undefined && typeof message['error'] !== 'string')
  ) {
    throw new Error('get_message response contains an invalid message')
  }
  return {
    role: 'assistant',
    content: message['content'],
    timestamp: message['timestamp'],
    error: message['error'],
  }
}

export function parseCommsResponse(value: unknown): ClawasCommsResponse {
  if (
    !isRecord(value) ||
    value['type'] !== 'response' ||
    typeof value['command'] !== 'string' ||
    typeof value['success'] !== 'boolean' ||
    (value['id'] !== undefined && typeof value['id'] !== 'string') ||
    (value['error'] !== undefined && typeof value['error'] !== 'string')
  ) {
    throw new Error('response has an invalid shape')
  }
  return {
    type: 'response',
    command: value['command'],
    success: value['success'],
    id: value['id'],
    data: value['data'],
    error: value['error'],
  }
}

export function parseSessionStatusData(value: unknown): ClawasSessionStatus {
  if (
    !isRecord(value) ||
    typeof value['sessionId'] !== 'string' ||
    !value['sessionId'] ||
    typeof value['cwd'] !== 'string' ||
    typeof value['isIdle'] !== 'boolean' ||
    typeof value['hasPendingMessages'] !== 'boolean' ||
    typeof value['lastSummary'] !== 'string' ||
    typeof value['updatedAt'] !== 'number' ||
    !Number.isFinite(value['updatedAt']) ||
    (value['workerId'] !== undefined && typeof value['workerId'] !== 'string') ||
    (value['sessionFile'] !== undefined && typeof value['sessionFile'] !== 'string') ||
    (value['currentToolName'] !== undefined && typeof value['currentToolName'] !== 'string') ||
    (value['lastError'] !== undefined && typeof value['lastError'] !== 'string')
  ) {
    throw new Error(
      'Clawas status is incompatible; upgrade or restart this worker (requires sessionId, cwd, boolean isIdle and hasPendingMessages, lastSummary, updatedAt)',
    )
  }
  return {
    workerId: value['workerId'],
    sessionId: value['sessionId'],
    sessionFile: value['sessionFile'],
    cwd: value['cwd'],
    isIdle: value['isIdle'],
    hasPendingMessages: value['hasPendingMessages'],
    currentToolName: value['currentToolName'],
    lastSummary: value['lastSummary'],
    lastError: value['lastError'],
    updatedAt: value['updatedAt'],
  }
}
