import * as net from 'node:net'
import { resolveSocketPath } from './paths.js'
import type {
  HowabandaCommsCommand,
  HowabandaDiscordContext,
  HowabandaExtractedMessage,
  HowabandaMessageIntent,
  HowabandaMessageKind,
  HowabandaMessageVisibility,
  HowabandaRpcResponse,
  HowabandaSendCommand,
  HowabandaSenderInfo,
} from './types.js'

interface SendCommandOptions {
  message: string
  mode?: 'steer' | 'followUp'
  messageType?: 'session' | 'report'
  discordContext?: HowabandaDiscordContext
  sender?: HowabandaSenderInfo
  kind?: HowabandaMessageKind
  intent?: HowabandaMessageIntent
  visibility?: HowabandaMessageVisibility
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
    `Timed out waiting for HOWABANDA socket for ${target}. Try restarting HOWABANDA or reopening that claw.`,
  )
}

async function sendRpcCommand(
  target: string,
  command: HowabandaCommsCommand,
  timeout = 5_000,
): Promise<HowabandaRpcResponse> {
  const socketPath = await resolveSocketPath(target)
  if (!socketPath) {
    throw new Error(`Unknown HOWABANDA session target: ${target}`)
  }

  return await new Promise<HowabandaRpcResponse>((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setEncoding('utf8')

    const timeoutHandle = setTimeout(() => {
      socket.destroy(new Error('timeout'))
    }, timeout)

    let buffer = ''
    const cleanup = () => {
      clearTimeout(timeoutHandle)
      socket.removeAllListeners()
    }

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(command)}\n`)
    })

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

        try {
          const response = JSON.parse(line) as HowabandaRpcResponse
          if (response.type === 'response') {
            cleanup()
            socket.end()
            resolve(response)
            return
          }
        } catch {
          // Ignore parse errors and keep reading.
        }
      }
    })

    socket.on('error', (error) => {
      cleanup()
      reject(error)
    })
  })
}

export async function sendHowabandaSessionMessage(
  target: string,
  options: SendCommandOptions,
): Promise<void> {
  await waitForSocketTarget(target)

  const command: HowabandaSendCommand = {
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
    throw new Error(response.error ?? `Failed to send HOWABANDA message to ${target}`)
  }
}

export async function getHowabandaLastAssistantMessage(
  target: string,
): Promise<HowabandaExtractedMessage | null> {
  const response = await sendRpcCommand(target, { type: 'get_message' })
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read HOWABANDA message from ${target}`)
  }

  const data = response.data as { message?: HowabandaExtractedMessage | null } | undefined
  return data?.message ?? null
}
