import type { AgentMessage } from '@earendil-works/pi-agent-core'

function isTextBlock(value: unknown): value is { type: 'text'; text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}

export function extractAssistantText(message: AgentMessage | undefined): string {
  if (message?.role !== 'assistant') {
    return ''
  }

  if (!Array.isArray(message.content)) {
    return ''
  }

  return message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('')
}
