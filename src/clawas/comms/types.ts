export interface ClawasExtractedMessage {
  role: 'assistant'
  content: string
  timestamp: number
  error?: string | undefined
}

export interface ClawasExtractedDelivery {
  route: 'discord' | 'main-claw'
  content: string
  timestamp: number
}

export type ClawasMessageKind = 'mail' | 'report' | 'coordination' | 'relay' | 'instruction'

export type ClawasMessageIntent = 'reply_requested' | 'for_context' | 'handoff' | 'status'

export type ClawasMessageVisibility = 'worker' | 'main-claw' | 'private'

export interface ClawasSenderInfo {
  workerId?: string | undefined
  workerTitle?: string | undefined
}

export interface ClawasDiscordContext {
  sourceMessageId?: string | undefined
  channelJid?: string | undefined
  queueRowId?: number | undefined
  messageHandles?: Record<string, { channelJid: string; messageId: string }> | undefined
}

export interface ClawasSendCommand {
  type: 'send'
  message: string
  mode?: 'steer' | 'followUp' | undefined
  messageType?: 'session' | 'report' | undefined
  discordContext?: ClawasDiscordContext | undefined
  sender?: ClawasSenderInfo | undefined
  kind?: ClawasMessageKind | undefined
  intent?: ClawasMessageIntent | undefined
  visibility?: ClawasMessageVisibility | undefined
  id?: string | undefined
}

interface ClawasGetMessageCommand {
  type: 'get_message'
  afterTimestamp?: number | undefined
  afterContent?: string | undefined
  id?: string | undefined
}

interface ClawasGetStatusCommand {
  type: 'get_status'
  id?: string | undefined
}

interface ClawasSubscribeStatusCommand {
  type: 'subscribe_status'
  id?: string | undefined
}

export interface ClawasSessionStatus {
  workerId?: string | undefined
  sessionId: string
  sessionFile?: string | undefined
  cwd: string
  isIdle: boolean
  hasPendingMessages: boolean
  currentToolName?: string | undefined
  lastSummary: string
  lastError?: string | undefined
  updatedAt: number
}

export interface ClawasCommsResponse {
  id?: string | undefined
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string | undefined
}

export interface ClawasStatusEvent {
  type: 'status'
  status: ClawasSessionStatus
}

export type ClawasCommsCommand =
  | ClawasSendCommand
  | ClawasGetMessageCommand
  | ClawasGetStatusCommand
  | ClawasSubscribeStatusCommand
