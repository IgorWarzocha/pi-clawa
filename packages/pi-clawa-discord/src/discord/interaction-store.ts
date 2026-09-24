import { randomBytes } from 'node:crypto'

export type DiscordInteractionAction =
  | { type: 'prompt'; prompt: string }
  | {
      type: 'modal'
      title: string
      label: string
      prompt: string
      placeholder?: string | undefined
      required: boolean
    }
  | { type: 'select'; options: Readonly<Record<string, string>> }

interface StoredInteraction {
  channelId: string
  messageId?: string | undefined
  expiresAt: number
  action: DiscordInteractionAction
}

const INTERACTION_TTL_MS = 7 * 24 * 60 * 60 * 1_000

export class DiscordInteractionStore {
  private readonly interactions = new Map<string, StoredInteraction>()

  create(channelId: string, action: DiscordInteractionAction): string {
    this.prune()
    const token = randomBytes(12).toString('base64url')
    this.interactions.set(token, {
      channelId,
      expiresAt: Date.now() + INTERACTION_TTL_MS,
      action,
    })
    return token
  }

  attach(tokens: string[], messageId: string): void {
    for (const token of tokens) {
      const stored = this.interactions.get(token)
      if (stored) stored.messageId = messageId
    }
  }

  peek(token: string, channelId: string, messageId?: string): DiscordInteractionAction | undefined {
    const stored = this.valid(token, channelId, messageId)
    return stored?.action
  }

  consume(
    token: string,
    channelId: string,
    messageId?: string,
  ): DiscordInteractionAction | undefined {
    const stored = this.valid(token, channelId, messageId)
    if (!stored) return undefined
    this.interactions.delete(token)
    return stored.action
  }

  delete(tokens: string[]): void {
    for (const token of tokens) this.interactions.delete(token)
  }

  clear(): void {
    this.interactions.clear()
  }

  private valid(
    token: string,
    channelId: string,
    messageId?: string,
  ): StoredInteraction | undefined {
    const stored = this.interactions.get(token)
    if (!stored || stored.expiresAt <= Date.now()) {
      this.interactions.delete(token)
      return undefined
    }
    if (stored.channelId !== channelId) return undefined
    if (messageId && stored.messageId && stored.messageId !== messageId) return undefined
    return stored
  }

  private prune(): void {
    const now = Date.now()
    for (const [token, stored] of this.interactions) {
      if (stored.expiresAt <= now) this.interactions.delete(token)
    }
  }
}
