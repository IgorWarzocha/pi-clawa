export type DiscordActivityDisposition =
  | 'ambient'
  | 'paused'
  | 'queued'
  | 'full'
  | 'blocked'
  | 'active'
  | 'handled'
  | 'replied'
  | 'deleted'

export interface DiscordActivityEvent {
  id: string
  channelLabel: string
  senderName: string
  body: string
  occurredAt: number
  disposition: DiscordActivityDisposition
}

export type DiscordConnectionState =
  | 'missing-token'
  | 'connecting'
  | 'connected'
  | 'stopped'
  | 'failed'
