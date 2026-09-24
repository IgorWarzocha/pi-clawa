import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ClawasSessionStatus } from './types.js'

// Event-fed fields, not a transcript projection. Never scan the session on a status update.
export class ClawasStatusState {
  private readonly activeTools = new Map<string, string>()
  private lastSummary = ''
  private lastError: string | undefined
  private updatedAt = Date.now()

  reset(): void {
    this.activeTools.clear()
    this.lastSummary = ''
    this.lastError = undefined
    this.updatedAt = Date.now()
  }

  agentStart(): void {
    this.activeTools.clear()
    this.lastError = undefined
    this.updatedAt = Date.now()
  }

  toolStart(id: string, name: string): void {
    this.activeTools.set(id, name)
    this.updatedAt = Date.now()
  }

  toolEnd(id: string, name: string, error: boolean): void {
    this.activeTools.delete(id)
    if (error) this.lastError = `${name} failed`
    this.updatedAt = Date.now()
  }

  message(content: unknown, error?: string): void {
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (part): part is { type: 'text'; text: string } =>
            part?.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (text) this.lastSummary = text.slice(0, 500)
    }
    if (error) this.lastError = error.slice(0, 500)
    this.updatedAt = Date.now()
  }

  changed(): void {
    this.updatedAt = Date.now()
  }

  deliveryFailure(message: string): void {
    this.lastError = message.slice(0, 500)
    this.updatedAt = Date.now()
  }

  snapshot(
    ctx: Pick<ExtensionContext, 'cwd' | 'isIdle' | 'hasPendingMessages'> & {
      sessionManager: Pick<ExtensionContext['sessionManager'], 'getSessionId' | 'getSessionFile'>
    },
    hasPendingKickoff = false,
  ): ClawasSessionStatus {
    return {
      workerId: process.env['PI_CLAWAS_WORKER_ID'],
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      cwd: ctx.cwd,
      isIdle: ctx.isIdle(),
      hasPendingMessages: ctx.hasPendingMessages() || hasPendingKickoff,
      currentToolName: [...this.activeTools.values()].at(-1),
      lastSummary: this.lastSummary,
      lastError: this.lastError,
      updatedAt: this.updatedAt,
    }
  }
}
