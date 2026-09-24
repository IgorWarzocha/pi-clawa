import type { DiscordBridgeState, DiscordInboundTurn } from './contracts.js'

export interface DiscordBridgeHost {
  isIdle(): boolean
  showTurns(turns: readonly DiscordInboundTurn[]): void
  deliverOutput(turns: readonly DiscordInboundTurn[], text: string): Promise<void>
  startTyping(channelId: string): () => void
  report(message: string, level: 'info' | 'warning' | 'error'): void
  stateChanged(state: DiscordBridgeState): void
}

interface ActiveBatch {
  turns: DiscordInboundTurn[]
  assistantText: string
  assistantError?: string | undefined
  stopTyping: Array<() => void>
  settlement?: Promise<void> | undefined
}

export class DiscordTurnCoordinator {
  private readonly queue: DiscordInboundTurn[] = []
  private readonly seen = new Set<string>()
  private readonly host: DiscordBridgeHost
  private readonly maxQueue: number
  private activeBatch: ActiveBatch | undefined
  private stopped = false

  constructor(host: DiscordBridgeHost, maxQueue: number) {
    this.host = host
    this.maxQueue = maxQueue
  }

  enqueue(turn: DiscordInboundTurn): boolean {
    return this.enqueueBatch([turn])
  }

  enqueueBatch(turns: readonly DiscordInboundTurn[]): boolean {
    if (this.stopped) return false
    const fresh: DiscordInboundTurn[] = []
    const freshIds = new Set<string>()
    for (const turn of turns) {
      if (freshIds.has(turn.id) || this.has(turn.id)) continue
      freshIds.add(turn.id)
      fresh.push(turn)
    }
    if (this.queue.length + fresh.length > this.maxQueue) return false
    for (const turn of fresh) this.insert(turn)
    if (fresh.length === 0) return true
    this.emitState()
    this.pump()
    return true
  }

  captureAssistant(text: string, error?: string): void {
    if (!this.activeBatch) return
    this.activeBatch.assistantText = text
    this.activeBatch.assistantError = error
  }

  async settle(): Promise<void> {
    const active = this.activeBatch
    if (!active) {
      this.pump()
      return
    }
    active.settlement ??= this.finish(active)
    await active.settlement
  }

  private async finish(active: ActiveBatch): Promise<void> {
    for (const stop of active.stopTyping.splice(0)) stop()
    try {
      await this.host.deliverOutput(active.turns, active.assistantText)
    } catch (error) {
      this.host.report(
        `Discord output failed: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    }
    if (this.stopped || this.activeBatch !== active) return
    if (active.assistantError) this.host.report(`Pi turn failed: ${active.assistantError}`, 'error')
    for (const turn of active.turns) this.seen.add(turn.id)
    trimSeen(this.seen)
    this.activeBatch = undefined
    this.emitState()
    queueMicrotask(() => this.pump())
  }

  updatePending(messageId: string, body: string): boolean {
    const pending = this.queue.find((turn) => turn.sourceMessageId === messageId)
    if (!pending) return false
    pending.body = body
    return true
  }

  removePending(messageId: string): boolean {
    const index = this.queue.findIndex((turn) => turn.sourceMessageId === messageId)
    if (index < 0) return false
    this.queue.splice(index, 1)
    this.emitState()
    return true
  }

  drainPending(): DiscordInboundTurn[] {
    const pending = this.queue.splice(0)
    if (pending.length > 0) this.emitState()
    return pending
  }

  get activeTurns(): readonly DiscordInboundTurn[] {
    return this.activeBatch?.turns ?? []
  }

  get state(): DiscordBridgeState {
    return { active: [...(this.activeBatch?.turns ?? [])], queued: this.queue.length }
  }

  wake(): void {
    this.pump()
  }

  stop(): void {
    this.stopped = true
    for (const stop of this.activeBatch?.stopTyping.splice(0) ?? []) stop()
    this.activeBatch = undefined
    this.queue.length = 0
    this.emitState()
  }

  private pump(): void {
    if (this.stopped || this.activeBatch || !this.host.isIdle()) return
    const first = this.queue[0]
    if (!first) return
    let batchSize = 1
    while (canShareBatch(first, this.queue[batchSize])) batchSize += 1
    const turns = this.queue.splice(0, batchSize)
    const active: ActiveBatch = {
      turns,
      assistantText: '',
      stopTyping: [],
    }
    this.activeBatch = active
    this.emitState()
    try {
      this.host.showTurns(turns)
      if (this.stopped || this.activeBatch !== active) return
      for (const channelId of new Set(turns.map((turn) => turn.channelId))) {
        active.stopTyping.push(this.host.startTyping(channelId))
      }
    } catch (error) {
      for (const stop of active.stopTyping.splice(0)) stop()
      if (this.stopped) return
      this.activeBatch = undefined
      this.queue.unshift(...turns)
      this.emitState()
      this.host.report(
        `Could not start the Discord turn: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    }
  }

  private emitState(): void {
    this.host.stateChanged(this.state)
  }

  private has(id: string): boolean {
    return (
      this.seen.has(id) ||
      this.activeBatch?.turns.some((item) => item.id === id) === true ||
      this.queue.some((queued) => queued.id === id)
    )
  }

  private insert(turn: DiscordInboundTurn): void {
    if (turn.cause === 'ambient') {
      this.queue.push(turn)
      return
    }
    const firstAmbient = this.queue.findIndex((queued) => queued.cause === 'ambient')
    if (firstAmbient < 0) this.queue.push(turn)
    else this.queue.splice(firstAmbient, 0, turn)
  }
}

function canShareBatch(
  first: DiscordInboundTurn,
  candidate: DiscordInboundTurn | undefined,
): boolean {
  if (!candidate || candidate.channelId !== first.channelId || candidate.cause !== first.cause) {
    return false
  }
  return first.cause === 'directed' || candidate.batchId === first.batchId
}

function trimSeen(seen: Set<string>): void {
  while (seen.size > 500) {
    const oldest = seen.values().next().value
    if (typeof oldest !== 'string') return
    seen.delete(oldest)
  }
}
