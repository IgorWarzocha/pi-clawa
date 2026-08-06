import * as net from 'node:net'
import { isRpcResponse } from '../rpc-guards.js'
import { resolveSocketPath } from './paths.js'
import { parseLastMessageData, parseSessionStatusData } from './protocol.js'
import type {
  ClawasCommsCommand,
  ClawasDiscordContext,
  ClawasExtractedMessage,
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasRpcResponse,
  ClawasSendCommand,
  ClawasSenderInfo,
} from './types.js'

interface SendCommandOptions {
  message: string
  mode?: 'steer' | 'followUp'
  messageType?: 'session' | 'report'
  discordContext?: ClawasDiscordContext
  sender?: ClawasSenderInfo
  kind?: ClawasMessageKind
  intent?: ClawasMessageIntent
  visibility?: ClawasMessageVisibility
}

function takeJsonLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  return { lines: parts.slice(0, -1).map((line) => line.trim()), rest: parts.at(-1) ?? '' }
}

function parseResponseLine(
  line: string,
  expectedCommand: ClawasCommsCommand['type'],
): ClawasRpcResponse {
  const response: unknown = JSON.parse(line)
  if (!isRpcResponse(response)) throw new Error('response has an invalid shape')
  if (response.command !== expectedCommand) {
    throw new Error(`response command ${response.command} does not match ${expectedCommand}`)
  }
  return response
}

async function waitForSocketTarget(target: string, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const socketPath = await resolveSocketPath(target)
    if (socketPath) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(
    `Timed out waiting for Clawas socket for ${target}. Try restarting Clawas or reopening that claw.`,
  )
}

async function sendRpcCommand(
  target: string,
  command: ClawasCommsCommand,
  timeout = 5_000,
): Promise<ClawasRpcResponse> {
  const socketPath = await resolveSocketPath(target)
  if (!socketPath) {
    throw new Error(`Unknown Clawas session target: ${target}`)
  }

  return await new Promise<ClawasRpcResponse>((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setEncoding('utf8')

    const timeoutHandle = setTimeout(() => {
      socket.destroy(new Error('timeout'))
    }, timeout)

    let buffer = ''
    let settled = false
    const cleanup = () => {
      clearTimeout(timeoutHandle)
      socket.removeAllListeners()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      socket.destroy()
      reject(error)
    }

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(command)}\n`)
    })

    socket.on('data', (chunk) => {
      buffer += chunk
      const framed = takeJsonLines(buffer)
      buffer = framed.rest
      for (const line of framed.lines.filter(Boolean)) {
        try {
          const response = parseResponseLine(line, command.type)
          settled = true
          cleanup()
          socket.end()
          resolve(response)
          return
        } catch (error) {
          fail(
            new Error(
              `Invalid Clawas response from ${target}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
          return
        }
      }
    })

    socket.on('error', (error) => {
      fail(error)
    })
    socket.on('end', () => fail(new Error(`Clawas session ${target} closed without a response`)))
  })
}

export async function sendClawasSessionMessage(
  target: string,
  options: SendCommandOptions,
): Promise<void> {
  await waitForSocketTarget(target)

  const command: ClawasSendCommand = {
    type: 'send',
    message: options.message,
    mode: options.mode,
    messageType: options.messageType,
    discordContext: options.discordContext,
    sender: options.sender,
    kind: options.kind,
    intent: options.intent,
    visibility: options.visibility,
  }
  const response = await sendRpcCommand(target, command, 30_000)
  if (!response.success) {
    throw new Error(response.error ?? `Failed to send Clawas message to ${target}`)
  }
}

export async function getClawasLastAssistantMessage(
  target: string,
): Promise<ClawasExtractedMessage | null> {
  const response = await sendRpcCommand(target, { type: 'get_message' })
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read Clawas message from ${target}`)
  }

  return parseLastMessageData(response.data)
}

export async function getClawasSessionStatus(
  target: string,
): Promise<
  { kind: 'managed'; isIdle: boolean; hasPendingMessages: boolean } | { kind: 'manual' } | null
> {
  try {
    const response = await sendRpcCommand(target, { type: 'get_status' }, 1_000)
    if (!response.success) {
      return response.error?.includes('manual session') ? { kind: 'manual' } : null
    }

    const data = parseSessionStatusData(response.data)
    return {
      kind: 'managed',
      isIdle: data.isIdle,
      hasPendingMessages: data.hasPendingMessages,
    }
  } catch {
    return null
  }
}
