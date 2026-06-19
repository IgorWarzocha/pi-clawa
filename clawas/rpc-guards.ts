import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { ClawasRpcResponse } from './rpc-types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isRpcResponse(value: unknown): value is ClawasRpcResponse {
  if (!isRecord(value)) return false
  if (value.type !== 'response') return false
  if (typeof value.command !== 'string') return false
  if (typeof value.success !== 'boolean') return false
  if (value.id !== undefined && typeof value.id !== 'string') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return true
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  return isRecord(value) && typeof value.type === 'string' && value.type !== 'response'
}
