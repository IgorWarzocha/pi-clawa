import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const UNKNOWN_CONTEXT_OVERFLOW_MARKER = /model_context_window_exceeded/i

export function normalizeUnknownContextOverflowMessage<
  T extends { role?: unknown; stopReason?: unknown; errorMessage?: unknown },
>(message: T): T | undefined {
  if (message.role !== 'assistant') return undefined
  if (message.stopReason !== 'error') return undefined
  if (typeof message.errorMessage !== 'string') return undefined
  if (message.errorMessage.includes('context_length_exceeded')) return undefined
  if (!UNKNOWN_CONTEXT_OVERFLOW_MARKER.test(message.errorMessage)) return undefined

  return {
    ...message,
    errorMessage: `context_length_exceeded: ${message.errorMessage}`,
  }
}

export function registerContextOverflowNormalization(pi: ExtensionAPI): void {
  pi.on('message_end', (event) => {
    const normalized = normalizeUnknownContextOverflowMessage(event.message)
    if (!normalized) return undefined
    return { message: normalized }
  })
}
