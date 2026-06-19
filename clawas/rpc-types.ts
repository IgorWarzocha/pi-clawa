import type { AgentEvent, ThinkingLevel } from '@earendil-works/pi-agent-core'

export type ClawasRpcCommand =
  | { id: string; type: 'prompt'; message: string }
  | { id: string; type: 'steer'; message: string }
  | { id: string; type: 'follow_up'; message: string }
  | { id: string; type: 'abort' }
  | { id: string; type: 'get_state' }
  | { id: string; type: 'get_last_assistant_text' }
  | { id: string; type: 'set_session_name'; name: string }

export interface ClawasRpcSessionState {
  isStreaming: boolean
  sessionFile?: string
  sessionId: string
  sessionName?: string
  thinkingLevel: ThinkingLevel
  pendingMessageCount: number
}

export interface ClawasRpcResponse {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
}

export type ClawasWorkerEvent = AgentEvent
