import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type {
  ClawasRpcAssistantText,
  ClawasRpcResponse,
  ClawasRpcSessionState,
} from './rpc-types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRpcResponse(value: unknown): value is ClawasRpcResponse {
  if (!isRecord(value)) return false
  if (value['type'] !== 'response') return false
  if (typeof value['command'] !== 'string') return false
  if (typeof value['success'] !== 'boolean') return false
  if (value['id'] !== undefined && typeof value['id'] !== 'string') return false
  if (value['error'] !== undefined && typeof value['error'] !== 'string') return false
  return true
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  return isRecord(value) && typeof value['type'] === 'string' && value['type'] !== 'response'
}

export function readRpcSessionState(data: unknown): ClawasRpcSessionState {
  if (!isRecord(data)) {
    throw new Error('Invalid get_state RPC data: expected an object')
  }
  const sessionFile = data['sessionFile']
  if (sessionFile !== undefined && typeof sessionFile !== 'string') {
    throw new Error('Invalid get_state RPC data: sessionFile must be a string or absent')
  }
  return sessionFile === undefined ? {} : { sessionFile }
}

export function readRpcAssistantText(data: unknown): ClawasRpcAssistantText {
  if (!isRecord(data)) {
    throw new Error('Invalid get_last_assistant_text RPC data: expected an object')
  }
  const text = data['text']
  // Pi 0.87.1 serializes an empty session as {} despite declaring text: string | null.
  if (text === undefined || text === null) return null
  if (typeof text !== 'string') {
    throw new Error(
      'Invalid get_last_assistant_text RPC data: text must be a string, null or absent',
    )
  }
  return text
}
