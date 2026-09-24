import { createServer, type Server, type Socket } from 'node:net'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { ClawasMailDelivery } from './mail-delivery.js'
import { getLastAssistantMessage } from './message-extract.js'
import {
  ensureControlDir,
  getSocketPath,
  removeAliasesForSocket,
  removeSocket,
  syncSocketAlias,
} from './paths.js'
import { parseClawasCommsCommand } from './protocol.js'
import { ClawasStatusState } from './status.js'
import type {
  ClawasCommsCommand,
  ClawasCommsResponse,
  ClawasSendCommand,
  ClawasStatusEvent,
} from './types.js'

const MAX_FRAME_BYTES = 1_048_576
const MAX_QUEUED_BYTES = 1_048_576
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
    const parsed = parseClawasCommsCommand(JSON.parse(line))
    return 'value' in parsed ? { command: parsed.value } : { error: parsed.error }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to parse command',
    }
  }
}

function writeResponse(socket: Socket, response: ClawasCommsResponse): void {
  try {
    socket.write(`${JSON.stringify(response)}\n`)
  } catch {
    // Socket may already be gone.
  }
}

/** Embedded control and status socket for the active Clawa session. */
export class ClawasCommsServer {
  private server: Server | null = null
  private socketPath: string | null = null
  private aliasSync: Promise<void> | null = null
  private transition: Promise<void> = Promise.resolve()
  private context: ExtensionContext | null = null
  private readonly mail: ClawasMailDelivery
  private readonly getAlias: () => string | undefined
  private readonly sockets = new Set<Socket>()
  private readonly subscribers = new Set<Socket>()
  private readonly status = new ClawasStatusState()

  constructor(pi: ExtensionAPI, getAlias: () => string | undefined) {
    this.mail = new ClawasMailDelivery(pi, (error) => {
      const message = `Clawas mail kickoff failed: ${error.message}`
      this.status.deliveryFailure(message)
      this.publishStatus()
      if (this.context?.hasUI) {
        try {
          this.context.ui.notify(message, 'error')
        } catch (notificationError) {
          console.error(message, notificationError)
        }
      }
    })
    this.getAlias = getAlias
  }

  start(ctx: ExtensionContext): Promise<void> {
    return this.serialize(() => this.startServer(ctx))
  }

  private async startServer(ctx: ExtensionContext): Promise<void> {
    await ensureControlDir()
    const sessionId = ctx.sessionManager.getSessionId()
    const socketPath = getSocketPath(sessionId)

    if (this.socketPath === socketPath && this.server) {
      this.context = ctx
      this.mail.reset()
      this.publishStatus()
      try {
        await this.syncAlias(sessionId)
      } catch (error) {
        await this.stopServer()
        throw error
      }
      return
    }

    await this.stopServer()
    await removeSocket(socketPath)
    this.context = ctx
    this.status.reset()
    this.socketPath = socketPath
    try {
      this.server = await this.createServer()
      await this.syncAlias(sessionId)
    } catch (error) {
      await this.stopServer()
      throw error
    }
  }

  stop(): Promise<void> {
    return this.serialize(() => this.stopServer())
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const work = this.transition.catch(() => {}).then(operation)
    this.transition = work
    return work
  }

  private async syncAlias(sessionId: string): Promise<void> {
    if (this.aliasSync) await this.aliasSync
    const work = syncSocketAlias(sessionId, this.getAlias())
    this.aliasSync = work
    try {
      await work
    } finally {
      if (this.aliasSync === work) this.aliasSync = null
    }
  }

  private async stopServer(): Promise<void> {
    this.mail.reset()

    const socketPath = this.socketPath
    this.socketPath = null
    this.context = null
    if (this.aliasSync) {
      // Cleanup must still run after an in-flight alias sync fails.
      await this.aliasSync.catch(() => {})
    }

    const server = this.server
    this.server = null
    for (const socket of this.sockets) socket.destroy()
    this.subscribers.clear()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    await removeAliasesForSocket(socketPath)
    await removeSocket(socketPath)
  }

  private async createServer(): Promise<Server> {
    if (!this.socketPath) {
      throw new Error('Clawas comms socket path is not ready')
    }

    const server = createServer((socket) => {
      this.sockets.add(socket)
      socket.on('close', () => {
        this.sockets.delete(socket)
        this.subscribers.delete(socket)
      })
      socket.on('error', () => socket.destroy())
      socket.setEncoding('utf8')
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer = this.receiveSocketData(socket, buffer, String(chunk))
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

  private receiveSocketData(socket: Socket, buffer: string, chunk: string): string {
    if (this.subscribers.has(socket)) {
      socket.destroy()
      return ''
    }
    let pending = buffer + chunk
    if (Buffer.byteLength(pending) > MAX_FRAME_BYTES) {
      socket.destroy()
      return ''
    }
    let newlineIndex = pending.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).trim()
      pending = pending.slice(newlineIndex + 1)
      if (line) this.receiveCommand(line, socket)
      if (this.subscribers.has(socket)) {
        if (pending.trim()) socket.destroy()
        return ''
      }
      newlineIndex = pending.indexOf('\n')
    }
    return pending
  }

  private receiveCommand(line: string, socket: Socket): void {
    const parsed = parseCommand(line)
    if (parsed.error || !parsed.command) {
      writeResponse(socket, {
        type: 'response',
        command: 'parse',
        success: false,
        error: parsed.error ?? 'Unknown parse error',
      })
      return
    }

    const command = parsed.command
    void this.handleCommand(command, socket).catch((error) => {
      writeResponse(socket, {
        type: 'response',
        command: command.type,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        id: command.id,
      })
    })
  }

  private async handleCommand(command: ClawasCommsCommand, socket: Socket): Promise<void> {
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

    if (command.type === 'subscribe_status') {
      // Write the initial snapshot before admitting this socket to event broadcasts.
      respond(true, 'subscribe_status', this.status.snapshot(ctx, this.mail.hasPendingKickoff))
      this.subscribers.add(socket)
      return
    }

    if (command.type === 'send') {
      await this.handleSendRpcCommand(ctx, command, respond, () => !socket.destroyed)
      return
    }

    respond(false, 'unknown', undefined, 'Unsupported command')
  }

  private handleGetMessageCommand(ctx: ExtensionContext, respond: CommandResponder): void {
    respond(true, 'get_message', {
      message: getLastAssistantMessage(ctx) ?? null,
    })
  }

  private handleGetStatusCommand(ctx: ExtensionContext, respond: CommandResponder): void {
    respond(true, 'get_status', this.status.snapshot(ctx, this.mail.hasPendingKickoff))
  }

  publishStatus(): void {
    const ctx = this.context
    if (!ctx) return
    this.status.changed()
    const event: ClawasStatusEvent = {
      type: 'status',
      status: this.status.snapshot(ctx, this.mail.hasPendingKickoff),
    }
    const line = `${JSON.stringify(event)}\n`
    for (const socket of this.subscribers) {
      if (socket.destroyed || socket.writableLength + Buffer.byteLength(line) > MAX_QUEUED_BYTES) {
        socket.destroy()
      } else {
        socket.write(line)
      }
    }
  }

  agentStart(): void {
    this.status.agentStart()
    if (this.context) this.mail.agentStart()
    this.publishStatus()
  }
  agentSettled(): void {
    if (this.context) this.mail.settled()
    this.publishStatus()
  }
  toolStart(id: string, name: string): void {
    this.status.toolStart(id, name)
    this.publishStatus()
  }
  toolEnd(id: string, name: string, isError: boolean): void {
    this.status.toolEnd(id, name, isError)
    this.publishStatus()
  }
  assistantMessage(content: unknown, error?: string): void {
    this.status.message(content, error)
    this.publishStatus()
  }

  private async handleSendRpcCommand(
    ctx: ExtensionContext,
    command: ClawasSendCommand,
    respond: CommandResponder,
    isConnected: () => boolean = () => true,
  ): Promise<void> {
    if (!isConnected()) return
    if (this.context !== ctx) {
      respond(false, 'send', undefined, 'Session changed before delivery')
      return
    }
    this.mail.send(ctx, command, () => this.context === ctx)
    this.publishStatus()
    respond(true, 'send', {
      delivered: true,
      type: command.messageType ?? 'session',
    })
  }
}
