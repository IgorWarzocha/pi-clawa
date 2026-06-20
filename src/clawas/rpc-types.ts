import type { AgentEvent, ThinkingLevel } from '@earendil-works/pi-agent-core'

export type ClawasRpcCommandInput =
  | { type: 'prompt'; message: string }
  | { type: 'steer'; message: string }
  | { type: 'follow_up'; message: string }
  | { type: 'abort' }
  | { type: 'get_state' }
  | { type: 'get_last_assistant_text' }
  | { type: 'set_session_name'; name: string }

export type ClawasRpcCommand = ClawasRpcCommandInput & { id: string }

export interface ClawasRpcSessionState {
  isStreaming: boolean
  sessionFile?: string | undefined
  sessionId: string
  sessionName?: string | undefined
  thinkingLevel: ThinkingLevel
  pendingMessageCount: number
}

export interface ClawasRpcResponse {
  id?: string | undefined
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string | undefined
}

export type ClawasWorkerEvent = AgentEvent
