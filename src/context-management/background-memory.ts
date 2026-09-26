import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { drain, listJobs } from './consolidation/index.js'
import { runConsolidationJob } from './consolidation/runner.js'

interface Attachment {
  rootHouse: string
  registry: ExtensionContext['modelRegistry']
  controller: AbortController
  timer: ReturnType<typeof setInterval>
  running: Promise<void> | undefined
  error: string | undefined
}

/** One lifecycle owner per extension; the durable queue's OS lock arbitrates across Clawas. */
export class BackgroundMemory {
  private attachment: Attachment | undefined
  private readonly pi: ExtensionAPI

  constructor(pi: ExtensionAPI) {
    this.pi = pi
  }

  async attach(rootHouse: string, ctx: ExtensionContext): Promise<void> {
    if (this.attachment?.rootHouse === rootHouse) {
      this.attachment.registry = ctx.modelRegistry
      this.kick()
      return
    }
    await this.stop()
    const timer = setInterval(() => this.kick(), 5_000)
    timer.unref()
    this.attachment = {
      rootHouse,
      registry: ctx.modelRegistry,
      controller: new AbortController(),
      timer,
      running: undefined,
      error: undefined,
    }
    this.kick()
  }

  kick(): void {
    const attachment = this.attachment
    if (!attachment || attachment.running || attachment.controller.signal.aborted) return
    attachment.running = this.pump(attachment).finally(() => {
      attachment.running = undefined
    })
  }

  private async pump(attachment: Attachment): Promise<void> {
    try {
      const before = listJobs(attachment.rootHouse)
      if (!before.some((job) => job.status === 'queued' || job.status === 'running')) return
      await drain(
        attachment.rootHouse,
        (job, signal) => runConsolidationJob(job, signal, { modelRegistry: attachment.registry }),
        attachment.controller.signal,
      )
      attachment.error = undefined
      const failedBefore = new Set(
        before.filter((job) => job.status === 'failed').map((job) => job.id),
      )
      const failed = listJobs(attachment.rootHouse).filter(
        (job) => job.status === 'failed' && !failedBefore.has(job.id),
      )
      if (failed.length > 0)
        this.report(
          `Memory consolidation failed for ${failed.map((job) => job.id).join(', ')}. /memory shows the error; /memory retry <id> retries it.`,
        )
    } catch (error) {
      if (attachment.controller.signal.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      if (attachment.error !== message) this.report(`Memory queue: ${message}`)
      attachment.error = message
    }
  }

  private report(content: string): void {
    this.pi.sendMessage(
      { customType: 'clawa-memory-status', content, display: true },
      { triggerTurn: false },
    )
  }

  async stop(): Promise<void> {
    const attachment = this.attachment
    this.attachment = undefined
    if (!attachment) return
    clearInterval(attachment.timer)
    attachment.controller.abort()
    await attachment.running
  }
}
