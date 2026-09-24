import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { DiscordClientRuntime } from '../discord/client.js'
import type { DiscordDeliveryRequest, DiscordDeliveryResult } from '../discord/delivery-contract.js'
import type { DiscordToolInput, DiscordToolTarget } from '../extension/tool.js'
import type { DiscordInboundTurn } from './contracts.js'
import { processDiscordOutput } from './output.js'
import {
  buildDiscordRoutes,
  type DiscordMessageRoute,
  type DiscordRouteRegistry,
  type DiscordRoutes,
} from './routes.js'

interface OutputHost {
  runtime(): DiscordClientRuntime | undefined
  report(message: string, level: 'warning' | 'error'): void
  completed(turnId: string, replied: boolean): void
}

/** Routes only explicit output. Closing a session cancels retries, never redirects them. */
export class DiscordSessionOutput implements DiscordToolTarget {
  private stopped = false
  private readonly abort = new AbortController()
  private readonly registry: DiscordRouteRegistry
  private readonly turns: () => readonly DiscordInboundTurn[]
  private readonly host: OutputHost

  constructor(
    registry: DiscordRouteRegistry,
    turns: () => readonly DiscordInboundTurn[],
    host: OutputHost,
  ) {
    this.registry = registry
    this.turns = turns
    this.host = host
  }

  stop(): void {
    this.stopped = true
    this.abort.abort()
  }

  async sendFromTool(input: DiscordToolInput, cwd: string): Promise<DiscordDeliveryResult> {
    const runtime = this.requireRuntime()
    const routes = buildDiscordRoutes(this.turns(), this.registry)
    const replyRoute = resolveMessageHandle(input.replyTo, routes)
    const reactionRoute = resolveMessageHandle(input.reaction?.to, routes)
    const defaultChannelId =
      replyRoute?.channelId ?? reactionRoute?.channelId ?? routes.channel?.channelId
    const channelId = await runtime.resolveChannel(input.channel, defaultChannelId)
    if (replyRoute && replyRoute.channelId !== channelId) {
      throw new Error('discord_send channel and replyTo point to different Discord channels.')
    }
    return await runtime.send({
      channelId,
      message: input.message?.trim() || undefined,
      title: input.title?.trim() || undefined,
      card: input.card,
      replyToMessageId: replyRoute?.messageId,
      files: (input.files ?? []).map((file) => ({ ...file, path: resolve(cwd, file.path) })),
      buttons: input.buttons,
      select: input.select,
      poll: input.poll,
      reaction:
        input.reaction && reactionRoute
          ? {
              channelId: reactionRoute.channelId,
              messageId: reactionRoute.messageId,
              emoji: input.reaction.emoji,
            }
          : undefined,
    })
  }

  async deliver(turns: readonly DiscordInboundTurn[], text: string): Promise<void> {
    if (this.stopped) return
    const routes = buildDiscordRoutes(turns, this.registry)
    const replied = new Set<string>()
    const batchId = turns.map((turn) => turn.id).join(':')
    await processDiscordOutput(text, async (block, index) => {
      if (this.stopped) return
      const route = routes.messagesByHandle.get(block.target)
      const channelId =
        route?.channelId ?? (block.target === 'c' ? routes.channel?.channelId : undefined)
      if (!channelId) {
        this.host.report(`Ignored unknown Discord route [${block.target}].`, 'warning')
        return
      }
      const nonce = createHash('sha256')
        .update(`${batchId}:${index}:${block.target}`)
        .digest('hex')
        .slice(0, 24)
      try {
        await this.sendWithRetry(
          {
            channelId,
            message: block.content,
            replyToMessageId: route?.messageId,
            files: [],
          },
          nonce,
        )
        if (route) replied.add(route.messageId)
      } catch (error) {
        if (!this.stopped) {
          this.host.report(`Discord route [${block.target}] failed: ${String(error)}`, 'error')
        }
      }
    })
    if (!this.stopped) {
      for (const turn of turns) this.host.completed(turn.id, replied.has(turn.replyToMessageId))
    }
  }

  private async sendWithRetry(request: DiscordDeliveryRequest, nonce: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.requireRuntime().send(request, nonce)
        return
      } catch (error) {
        if (this.stopped || attempt === 2) throw error
        await delay(500 * 2 ** attempt, this.abort.signal)
      }
    }
  }

  private requireRuntime(): DiscordClientRuntime {
    const runtime = this.host.runtime()
    if (this.stopped || !runtime?.connected)
      throw new Error('Discord is not connected in this Pi tab. Run /discord.')
    return runtime
  }
}

function resolveMessageHandle(
  handle: string | undefined,
  routes: DiscordRoutes,
): DiscordMessageRoute | undefined {
  if (!handle) return
  const route = routes.messagesByHandle.get(handle.toLowerCase())
  if (!route) {
    throw new Error(
      'Unknown message handle. Available: ' +
        (routes.messages.map((item) => item.handle).join(', ') || 'none'),
    )
  }
  return route
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  await new Promise<void>((resolvePromise, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort)
      resolvePromise()
    }
    const timer = setTimeout(finish, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
