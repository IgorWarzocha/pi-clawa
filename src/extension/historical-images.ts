const OMITTED_IMAGE_NOTE = '[Earlier image omitted from replay after it was processed.]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isImageBlock(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value['type'] === 'image'
}

function messageContent(message: unknown): unknown[] | null {
  if (!(isRecord(message) && Array.isArray(message['content']))) return null
  return message['content']
}

function isUserMessage(message: unknown): boolean {
  return isRecord(message) && message['role'] === 'user'
}

function isToolResultMessage(message: unknown): boolean {
  return isRecord(message) && message['role'] === 'toolResult'
}

/**
 * Keep the latest user image message and images at the provider-call tail.
 *
 * Pi persists image blocks as base64. Replaying every processed screenshot can hit the
 * transport byte limit long before token-based auto-compaction runs. Each image makes one
 * one-way transition to a stable marker after the model has seen it, so old prompt-cache
 * prefixes do not churn as a sliding image window advances. This transform is provider-only:
 * the session keeps its original images for inspection and branch history.
 */
export function boundHistoricalImages<T>(messages: T[]): T[] {
  let latestUserImageIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messageContent(messages[index])
    if (isUserMessage(messages[index]) && content?.some(isImageBlock)) {
      latestUserImageIndex = index
      break
    }
  }

  let freshToolBatchStart = messages.length
  while (freshToolBatchStart > 0 && isToolResultMessage(messages[freshToolBatchStart - 1])) {
    freshToolBatchStart -= 1
  }

  let changed = false
  const bounded = messages.map((message, messageIndex) => {
    if (messageIndex >= freshToolBatchStart || messageIndex === latestUserImageIndex) {
      return message
    }
    const content = messageContent(message)
    if (!(content && isRecord(message))) return message

    let contentChanged = false
    const nextContent = content.map((block) => {
      if (!isImageBlock(block)) return block
      contentChanged = true
      return { type: 'text', text: OMITTED_IMAGE_NOTE }
    })
    if (!contentChanged) return message
    changed = true
    return { ...message, content: nextContent } as T
  })

  return changed ? bounded : messages
}
