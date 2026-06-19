export interface HowabandaExtractedMessage {
  role: 'assistant'
  content: string
  timestamp: number
}

export interface HowabandaExtractedDelivery {
  route: 'discord' | 'main-claw'
  content: string
  timestamp: number
}

export type HowabandaMessageKind = 'mail' | 'report' | 'coordination' | 'relay' | 'instruction'

export type HowabandaMessageIntent = 'reply_requested' | 'for_context' | 'handoff' | 'status'

export type HowabandaMessageVisibility = 'worker' | 'main-claw' | 'private'

export interface HowabandaSenderInfo {
  workerId?: string
  workerTitle?: string
}

export interface HowabandaDiscordContext {
  sourceMessageId?: string
}

export interface HowabandaSendCommand {
  type: 'send'
  message: string
  mode?: 'steer' | 'followUp'
  messageType?: 'session' | 'report'
  discordContext?: HowabandaDiscordContext
  sender?: HowabandaSenderInfo
  kind?: HowabandaMessageKind
  intent?: HowabandaMessageIntent
  visibility?: HowabandaMessageVisibility
  id?: string
}

export interface HowabandaGetMessageCommand {
  type: 'get_message'
  id?: string
}

export interface HowabandaGetStatusCommand {
  type: 'get_status'
  id?: string
}

export type HowabandaCommsCommand =
  | HowabandaSendCommand
  | HowabandaGetMessageCommand
  | HowabandaGetStatusCommand

export interface HowabandaRpcResponse {
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
  id?: string
}
