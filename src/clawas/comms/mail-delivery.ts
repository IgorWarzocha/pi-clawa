import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.js'
import {
  buildClawasMailContext,
  buildMessageDetails,
  getLegacyMailCustomType,
  resolveMessageIntent,
  resolveMessageKind,
  resolveMessageVisibility,
  shouldTriggerTurn,
} from './server-messages.js'
import type { ClawasSendCommand } from './types.js'

/** Owns mail metadata, delivery policy, and one coalesced idle user kickoff. */
export class ClawasMailDelivery {
  private pending: string[] = []
  private scheduled = false
  private inFlight = false
  private readonly pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage' | 'sendUserMessage'>
  private readonly onFailure: (error: Error) => void

  constructor(
    pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage' | 'sendUserMessage'>,
    onFailure: (error: Error) => void,
  ) {
    this.pi = pi
    this.onFailure = onFailure
  }

  get hasPendingKickoff(): boolean {
    return this.scheduled || this.inFlight || this.pending.length > 0
  }

  reset(): void {
    this.pending = []
    this.scheduled = false
    this.inFlight = false
  }

  agentStart(): void {
    this.inFlight = false
    const queued = this.pending.splice(0)
    if (queued.length > 0) {
      try {
        this.pi.sendUserMessage(queued.join('\n\n'), { deliverAs: 'steer' })
      } catch (error) {
        this.reset()
        this.onFailure(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  settled(): void {
    if (!this.inFlight) return
    this.reset()
    this.onFailure(new Error('turn did not start; mail remains in session history'))
  }

  send(
    ctx: Pick<ExtensionContext, 'isIdle'>,
    command: ClawasSendCommand,
    isCurrent: () => boolean,
  ): void {
    const kind = resolveMessageKind(command)
    const intent = resolveMessageIntent(command, kind)
    const details = buildMessageDetails(
      command.sender,
      kind,
      intent,
      resolveMessageVisibility(command, kind),
    )
    const isReport = command.messageType === 'report'
    const deliverAs = isReport
      ? 'steer'
      : ctx.isIdle()
        ? undefined
        : command.mode === 'followUp'
          ? 'followUp'
          : 'steer'

    if (!isReport && shouldTriggerTurn(command)) {
      const content = buildClawasMailContext(command.message, details)
      this.pi.appendEntry(CLAWAS_MAIL_MESSAGE_TYPE, {
        rawContent: command.message,
        userMessageContent: content,
        details,
        messageType: command.messageType ?? 'session',
        mode: command.mode,
      })
      if (deliverAs) this.pi.sendUserMessage(content, { deliverAs })
      else this.queueIdle(ctx, content, isCurrent)
      return
    }

    this.pi.sendMessage(
      {
        customType: getLegacyMailCustomType(command),
        content: buildClawasMailContext(command.message, details),
        display: true,
        details: { ...details, rawContent: command.message },
      },
      deliverAs
        ? { triggerTurn: shouldTriggerTurn(command), deliverAs }
        : { triggerTurn: shouldTriggerTurn(command) },
    )
  }

  private queueIdle(
    ctx: Pick<ExtensionContext, 'isIdle'>,
    content: string,
    isCurrent: () => boolean,
  ): void {
    this.pending.push(content)
    if (this.scheduled || this.inFlight) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      const messages = this.pending.splice(0)
      if (messages.length === 0 || !isCurrent()) return
      // One user kickoff claims all mail received before the run starts.
      const idle = ctx.isIdle()
      this.inFlight = idle
      try {
        this.pi.sendUserMessage(messages.join('\n\n'), idle ? {} : { deliverAs: 'steer' })
      } catch (error) {
        this.reset()
        this.onFailure(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}
