export interface DiscordMessageHandle {
  channelId: string
  messageId: string
}

export interface DiscordContextLine {
  messageId: string
  senderName: string
  body: string
  kind: 'recent' | 'reply'
}

interface DiscordAttachment {
  name: string
  contentType: string
  size: number
  localPath: string
}

export interface DiscordInboundTurn {
  id: string
  cause: 'ambient' | 'directed'
  batchId?: string | undefined
  channelId: string
  channelLabel: string
  senderName: string
  sourceMessageId: string
  replyToMessageId: string
  body: string
  receivedAt: string
  context: DiscordContextLine[]
  attachments: DiscordAttachment[]
  handles: Readonly<Record<string, DiscordMessageHandle>>
}

export interface DiscordBridgeState {
  active: DiscordInboundTurn[]
  queued: number
}
