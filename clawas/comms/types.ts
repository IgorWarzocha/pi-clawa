export interface ClawasExtractedMessage {
  role: 'assistant'
  content: string
  timestamp: number
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
  workerId?: string
  workerTitle?: string
}

export interface ClawasDiscordContext {
  sourceMessageId?: string
}

export interface ClawasSendCommand {
  type: 'send'
  message: string
  mode?: 'steer' | 'followUp'
  messageType?: 'session' | 'report'
  discordContext?: ClawasDiscordContext
  sender?: ClawasSenderInfo
  kind?: ClawasMessageKind
  intent?: ClawasMessageIntent
  visibility?: ClawasMessageVisibility
  id?: string
}

export interface ClawasGetMessageCommand {
  type: 'get_message'
  id?: string
}

export interface ClawasGetStatusCommand {
  type: 'get_status'
  id?: string
}

export type ClawasCommsCommand =
  | ClawasSendCommand
  | ClawasGetMessageCommand
  | ClawasGetStatusCommand

export interface ClawasRpcResponse {
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
  id?: string
}
