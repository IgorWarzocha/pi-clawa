import { createServer, type Server, type Socket } from 'node:net'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  getLastAssistantMessage,
  getLastDeliveryMessage,
  getLastMailMessageDetails,
} from './message-extract.js'
import { CLAWAS_MAIL_MESSAGE_TYPE } from './outbound.js'
import {
  ensureControlDir,
  getSocketPath,
  removeAliasesForSocket,
  removeSocket,
  syncSocketAlias,
} from './paths.js'
import {
  buildMessageDetails,
  buildWorkerUserMessage,
  getLegacyMailCustomType,
  resolveMessageIntent,
  resolveMessageKind,
  resolveMessageVisibility,
  shouldAllowManualSessionSend,
  shouldDeliverClawasMailAsUserMessage,
  shouldTriggerTurn,
} from './server-messages.js'

export { buildMessageDetails, buildWorkerUserMessage, shouldDeliverClawasMailAsUserMessage }

import type { ClawasCommsCommand, ClawasRpcResponse, ClawasSendCommand } from './types.js'

const IS_MANUAL_SESSION = process.env['PI_CLAWAS_MANUAL_SESSION'] === '1'
type CommandResponder = (
  success: boolean,
  commandName: string,
  data?: unknown,
  error?: string,
) => void
function parseCommand(line: string): {
  command?: ClawasCommsCommand
  error?: string
} {
  try {
    const parsed = JSON.parse(line) as ClawasCommsCommand
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return { error: 'Invalid command' }
    }
    return { command: parsed }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to parse command',
    }
  }
}

function writeResponse(socket: Socket, response: ClawasRpcResponse): void {
  try {
    socket.write(`${JSON.stringify(response)}\n`)
  } catch {
    // Socket may already be gone.
  }
}

/**
 * Minimal embedded session-control server for Clawas.
 * It only supports fire-and-forget sends and reading the last assistant message.
 */
export class ClawasCommsServer {
  private server: Server | null = null
  private socketPath: string | null = null
  private aliasTimer: ReturnType<typeof setInterval> | null = null
  private context: ExtensionContext | null = null
  private readonly pi: ExtensionAPI
  private readonly getAlias: () => string | undefined

  constructor(pi: ExtensionAPI, getAlias: () => string | undefined) {
    this.pi = pi
    this.getAlias = getAlias
  }

  async start(ctx: ExtensionContext): Promise<void> {
    await ensureControlDir()
    const sessionId = ctx.sessionManager.getSessionId()
    const socketPath = getSocketPath(sessionId)

    if (this.socketPath === socketPath && this.server) {
      this.context = ctx
      await syncSocketAlias(sessionId, this.getAlias())
      return
    }

    await this.stop()
    await removeSocket(socketPath)
    this.context = ctx
    this.socketPath = socketPath
    this.server = await this.createServer()
    await syncSocketAlias(sessionId, this.getAlias())

    if (!this.aliasTimer) {
      this.aliasTimer = setInterval(() => {
        if (!this.context) {
          return
        }
        void syncSocketAlias(this.context.sessionManager.getSessionId(), this.getAlias())
      }, 1_000)
      this.aliasTimer.unref?.()
    }
  }

  async stop(): Promise<void> {
    if (this.aliasTimer) {
      clearInterval(this.aliasTimer)
      this.aliasTimer = null
    }

    const socketPath = this.socketPath
    this.socketPath = null
    this.context = null

    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.server = null
    }

    await removeAliasesForSocket(socketPath)
    await removeSocket(socketPath)
  }

  private async createServer(): Promise<Server> {
    if (!this.socketPath) {
      throw new Error('Clawas comms socket path is not ready')
    }

    const server = createServer((socket) => {
      socket.setEncoding('utf8')
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')
          if (!line) {
            continue
          }

          const parsed = parseCommand(line)
          if (parsed.error || !parsed.command) {
            writeResponse(socket, {
              type: 'response',
              command: 'parse',
              success: false,
              error: parsed.error ?? 'Unknown parse error',
            })
            continue
          }

          this.handleCommand(parsed.command, socket)
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    return server
  }

  private handleCommand(command: ClawasCommsCommand, socket: Socket): void {
    const ctx = this.context
    const id = 'id' in command && typeof command.id === 'string' ? command.id : undefined
    const respond = (success: boolean, commandName: string, data?: unknown, error?: string) => {
      writeResponse(socket, {
        type: 'response',
        command: commandName,
        success,
        data,
        error,
        id,
      })
    }

    if (!ctx) {
      respond(false, command.type, undefined, 'Session not ready')
      return
    }

    if (command.type === 'get_message') {
      this.handleGetMessageCommand(ctx, respond)
      return
    }

    if (command.type === 'get_status') {
      this.handleGetStatusCommand(ctx, respond)
      return
    }

    if (command.type === 'send') {
      this.handleSendRpcCommand(ctx, command, respond)
      return
    }

    respond(false, 'unknown', undefined, 'Unsupported command')
  }

  private handleGetMessageCommand(ctx: ExtensionContext, respond: CommandResponder): void {
    if (IS_MANUAL_SESSION) {
      respond(false, 'get_message', undefined, 'Worker is in a manual session')
      return
    }
    respond(true, 'get_message', {
      message: getLastAssistantMessage(ctx) ?? null,
      delivery: getLastDeliveryMessage(ctx) ?? null,
      discordContext: getLastMailMessageDetails(ctx) ?? null,
    })
  }

  private handleGetStatusCommand(ctx: ExtensionContext, respond: CommandResponder): void {
    if (IS_MANUAL_SESSION) {
      respond(false, 'get_status', undefined, 'Worker is in a manual session')
      return
    }
    respond(true, 'get_status', {
      isIdle: ctx.isIdle(),
      hasPendingMessages: ctx.hasPendingMessages(),
    })
  }

  private handleSendRpcCommand(
    ctx: ExtensionContext,
    command: ClawasSendCommand,
    respond: CommandResponder,
  ): void {
    if (IS_MANUAL_SESSION && !shouldAllowManualSessionSend(command)) {
      respond(false, 'send', undefined, 'Worker is in a manual session')
      return
    }
    this.handleSendCommand(ctx, command)
    respond(true, 'send', {
      delivered: true,
      type: command.messageType ?? 'session',
    })
  }

  private handleSendCommand(ctx: ExtensionContext, command: ClawasSendCommand): void {
    const kind = resolveMessageKind(command)
    const intent = resolveMessageIntent(command, kind)
    const visibility = resolveMessageVisibility(command, kind)
    const customType = CLAWAS_MAIL_MESSAGE_TYPE
    const isReport = command.messageType === 'report'
    const details = buildMessageDetails(
      command.sender,
      command.discordContext,
      kind,
      intent,
      visibility,
    )

    const deliverAs = isReport
      ? 'steer'
      : ctx.isIdle()
        ? undefined
        : command.mode === 'followUp'
          ? 'followUp'
          : 'steer'

    if (shouldDeliverClawasMailAsUserMessage(details)) {
      const content = buildWorkerUserMessage(command.message, details)
      this.pi.appendEntry(customType, {
        rawContent: command.message,
        userMessageContent: content,
        details,
        messageType: command.messageType ?? 'session',
        mode: command.mode,
      })

      this.pi.sendUserMessage(content, deliverAs ? { deliverAs } : {})
      return
    }

    this.pi.sendMessage(
      {
        customType: getLegacyMailCustomType(command),
        content: command.message,
        display: true,
        details,
      },
      deliverAs
        ? { triggerTurn: shouldTriggerTurn(command), deliverAs }
        : { triggerTurn: shouldTriggerTurn(command) },
    )
  }
}
