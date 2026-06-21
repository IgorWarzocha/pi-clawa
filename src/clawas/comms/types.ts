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

export interface ClawasGetMessageCommand {
  type: 'get_message'
  id?: string | undefined
}

export interface ClawasGetStatusCommand {
  type: 'get_status'
  id?: string | undefined
}

export type ClawasCommsCommand =
  | ClawasSendCommand
  | ClawasGetMessageCommand
  | ClawasGetStatusCommand

export type { ClawasRpcResponse } from '../rpc-types.js'
