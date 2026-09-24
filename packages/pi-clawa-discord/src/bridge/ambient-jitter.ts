import type { DiscordInboundTurn } from './contracts.js'

type AmbientJitterStatus = 'full' | 'queued' | 'waiting'

interface AmbientJitterResult {
  status: AmbientJitterStatus
  turns: readonly DiscordInboundTurn[]
}

interface AmbientBucket {
  threshold: number
  turns: DiscordInboundTurn[]
}

interface AmbientJitterOptions {
  minMessages: number
  maxMessages: number
  enqueue(turns: readonly DiscordInboundTurn[]): boolean
  random?: (() => number) | undefined
}

export class AmbientJitter {
  private readonly buckets = new Map<string, AmbientBucket>()
  private readonly enqueue: (turns: readonly DiscordInboundTurn[]) => boolean
  private readonly maxMessages: number
  private readonly minMessages: number
  private readonly random: () => number

  constructor(options: AmbientJitterOptions) {
    if (
      !(Number.isInteger(options.minMessages) && Number.isInteger(options.maxMessages)) ||
      options.minMessages < 1 ||
      options.maxMessages < options.minMessages
    ) {
      throw new Error('Ambient wake range must be positive integers in ascending order.')
    }
    this.minMessages = options.minMessages
    this.maxMessages = options.maxMessages
    this.enqueue = options.enqueue
    this.random = options.random ?? Math.random
  }

  offer(turn: DiscordInboundTurn): AmbientJitterResult {
    if (turn.cause !== 'ambient') throw new Error('Ambient jitter accepts ambient turns only.')
    let bucket = this.buckets.get(turn.channelId)
    if (!bucket) {
      bucket = { threshold: this.nextThreshold(), turns: [] }
      this.buckets.set(turn.channelId, bucket)
    }
    if (bucket.turns.some((candidate) => candidate.id === turn.id)) {
      return { status: 'waiting', turns: [] }
    }
    bucket.turns.push(turn)
    if (bucket.turns.length < bucket.threshold) return { status: 'waiting', turns: [] }

    this.buckets.delete(turn.channelId)
    const batchId = `ambient:${turn.id}`
    const turns = bucket.turns.map((candidate) => ({ ...candidate, batchId }))
    return {
      status: this.enqueue(turns) ? 'queued' : 'full',
      turns,
    }
  }

  reset(channelId: string): void {
    this.buckets.delete(channelId)
  }

  clear(): void {
    this.buckets.clear()
  }

  updatePending(messageId: string, body: string): boolean {
    for (const bucket of this.buckets.values()) {
      const turn = bucket.turns.find((candidate) => candidate.sourceMessageId === messageId)
      if (!turn) continue
      turn.body = body
      return true
    }
    return false
  }

  removePending(messageId: string): boolean {
    for (const [channelId, bucket] of this.buckets) {
      const index = bucket.turns.findIndex((turn) => turn.sourceMessageId === messageId)
      if (index < 0) continue
      bucket.turns.splice(index, 1)
      if (bucket.turns.length === 0) this.buckets.delete(channelId)
      return true
    }
    return false
  }

  private nextThreshold(): number {
    const sampled = this.random()
    const unit = Number.isFinite(sampled) ? Math.min(Math.max(sampled, 0), 1 - Number.EPSILON) : 0
    return this.minMessages + Math.floor(unit * (this.maxMessages - this.minMessages + 1))
  }
}
