import type { ClawasContextCommand, SharedResidentContext } from './context-protocol.js'

export interface ClawasExtractedMessage {
  role: 'assistant'
  content: string
  timestamp: number
  error?: string | undefined
}

export interface ClawasExtractedDelivery {
  route: 'main-claw'
  content: string
  timestamp: number
}

export type ClawasMessageKind = 'mail' | 'report' | 'coordination' | 'instruction'

export type ClawasMessageIntent = 'reply_requested' | 'for_context' | 'handoff' | 'status'

export type ClawasMessageVisibility = 'worker' | 'main-claw' | 'private'

export interface ClawasSenderInfo {
  workerId?: string | undefined
  workerTitle?: string | undefined
}

export interface ClawasSendCommand {
  type: 'send'
  message: string
  mode?: 'steer' | 'followUp' | undefined
  messageType?: 'session' | 'report' | undefined
  sender?: ClawasSenderInfo | undefined
  kind?: ClawasMessageKind | undefined
  intent?: ClawasMessageIntent | undefined
  visibility?: ClawasMessageVisibility | undefined
  id?: string | undefined
}

interface ClawasGetMessageCommand {
  type: 'get_message'
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
  sharedContext?: SharedResidentContext | undefined
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
  | ClawasContextCommand
  | ClawasGetMessageCommand
  | ClawasGetStatusCommand
  | ClawasSubscribeStatusCommand
