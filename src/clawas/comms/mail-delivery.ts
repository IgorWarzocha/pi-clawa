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

const START_ACK_MS = 15_000
type WakeMessage = Parameters<ExtensionAPI['sendMessage']>[0]
type KickoffContext = Pick<ExtensionContext, 'isIdle' | 'model' | 'modelRegistry'>
type Flight =
  | { kind: 'submitted'; timer: ReturnType<typeof setTimeout> }
  | { kind: 'unconfirmed'; error: Error }

async function checkReadiness(ctx: KickoffContext): Promise<void> {
  const model = ctx.model
  if (!model)
    throw new Error(
      'No model selected. Use /model in this tab to select the intended configured model, then resend. Ask the user before changing provider, account, or billing.',
    )
  if (ctx.modelRegistry.hasConfiguredAuth(model)) return
  const unavailable = new Error('No authentication available')
  const timedOut = new Error('Authentication check timed out')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const auth = await Promise.race([
      ctx.modelRegistry.getProviderAuth(model.provider),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timedOut), START_ACK_MS)
      }),
    ])
    if (!auth) throw unavailable
  } catch (error) {
    // Provider errors may quote a credential-bearing config value or shell command.
    const reason =
      error === unavailable
        ? unavailable.message
        : error === timedOut
          ? timedOut.message
          : 'Authentication check failed'
    throw new Error(
      `${reason} for "${model.provider}". Check this tab's existing credentials, then resend. Ask the user before changing provider, account, billing, or global Pi configuration.`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Mail and Pulses share one prepared idle kickoff; native custom wakes skip Pi preparation. */
export class ClawasMailDelivery {
  private pending: string[] = []
  private draining: Promise<void> | undefined
  private flight: Flight | undefined
  private epoch = 0
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
    if (this.flight?.kind === 'unconfirmed') return false
    return Boolean(this.draining || this.flight || this.pending.length > 0)
  }

  reset(): void {
    this.epoch += 1
    this.pending = []
    this.draining = undefined
    this.clearFlight()
  }

  private clearFlight(): void {
    if (this.flight?.kind === 'submitted') clearTimeout(this.flight.timer)
    this.flight = undefined
  }

  private assertWakeAllowed(): void {
    if (this.flight?.kind === 'unconfirmed') throw this.flight.error
  }

  agentStart(): void {
    if (!this.flight) return
    this.clearFlight()
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
    if (!this.flight) return
    this.reset()
    this.onFailure(
      new Error(
        'Turn did not start. Mail remains in session history; inspect this tab before resending.',
      ),
    )
  }

  async send(
    ctx: KickoffContext,
    command: ClawasSendCommand,
    isCurrent: () => boolean,
  ): Promise<void> {
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
      else await this.queueIdle(ctx, content, isCurrent)
      return
    }

    const message = {
      customType: getLegacyMailCustomType(command),
      content: buildClawasMailContext(command.message, details),
      display: true,
      details: { ...details, rawContent: command.message },
    }
    if (shouldTriggerTurn(command))
      await this.sendCustom(ctx, message, deliverAs ?? 'steer', isCurrent)
    else this.pi.sendMessage(message, { triggerTurn: false })
  }

  async sendCustom(
    ctx: KickoffContext,
    message: WakeMessage,
    deliverAs: 'steer' | 'followUp',
    isCurrent: () => boolean,
  ): Promise<void> {
    if (!isCurrent()) throw new Error('Clawa session changed before delivery')
    if (ctx.isIdle()) {
      this.assertWakeAllowed()
      const epoch = this.epoch
      // A failed Pulse remains due. Do not append actionable history on each failed retry.
      try {
        await checkReadiness(ctx)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error))
        if (epoch === this.epoch && isCurrent()) this.onFailure(failure)
        throw failure
      }
      if (epoch !== this.epoch || !isCurrent())
        throw new Error('Clawa session changed before delivery')
      this.assertWakeAllowed()
    }
    if (!ctx.isIdle()) {
      this.pi.sendMessage(message, { triggerTurn: true, deliverAs })
      return
    }
    // Keep the custom message and its metadata durable, but start through Pi's full prompt path.
    this.pi.sendMessage(message, { triggerTurn: false })
    await this.queueIdle(ctx, 'Handle the pending Clawa reports and Pulses above.', isCurrent)
  }

  private async queueIdle(
    ctx: KickoffContext,
    content: string,
    isCurrent: () => boolean,
  ): Promise<void> {
    this.assertWakeAllowed()
    this.pending.push(content)
    if (this.draining) return await this.draining
    if (this.flight) return
    const work = this.drain(ctx, isCurrent, this.epoch)
    this.draining = work
    try {
      await work
    } finally {
      if (this.draining === work) this.draining = undefined
    }
  }

  private async drain(ctx: KickoffContext, isCurrent: () => boolean, epoch: number): Promise<void> {
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (epoch !== this.epoch || !isCurrent())
        throw new Error('Clawa session changed before delivery')
      if (ctx.isIdle()) await checkReadiness(ctx)
      if (epoch !== this.epoch || !isCurrent())
        throw new Error('Clawa session changed before delivery')
      if (ctx.isIdle()) {
        const timer = setTimeout(() => {
          const error = new Error(
            'Pi has not acknowledged this Clawa wake. Inspect the target tab; if no turn is preparing, reload that tab before resending. Mail remains in history. No automatic resend or provider change was attempted.',
          )
          this.flight = { kind: 'unconfirmed', error }
          this.onFailure(error)
        }, START_ACK_MS)
        timer.unref?.()
        this.flight = { kind: 'submitted', timer }
      }
      const messages = this.pending.splice(0)
      // Always allow steering if an interactive turn wins the race after readiness checking.
      this.pi.sendUserMessage(messages.join('\n\n'), { deliverAs: 'steer' })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (epoch === this.epoch) {
        this.reset()
        this.onFailure(failure)
      }
      throw failure
    }
  }
}
