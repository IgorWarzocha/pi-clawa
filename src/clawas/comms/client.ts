import * as net from 'node:net'
import { resolveSocketPath } from './paths.js'
import { parseCommsResponse, parseLastMessageData, parseSessionStatusData } from './protocol.js'
import type {
  ClawasCommsCommand,
  ClawasCommsResponse,
  ClawasExtractedMessage,
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasSendCommand,
  ClawasSenderInfo,
  ClawasSessionStatus,
} from './types.js'

interface SendCommandOptions {
  message: string
  mode?: 'steer' | 'followUp'
  messageType?: 'session' | 'report'
  sender?: ClawasSenderInfo
  kind?: ClawasMessageKind
  intent?: ClawasMessageIntent
  visibility?: ClawasMessageVisibility
}

const MAX_FRAME_BYTES = 1_048_576

function takeJsonLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  return { lines: parts.slice(0, -1).map((line) => line.trim()), rest: parts.at(-1) ?? '' }
}

function parseResponseLine(
  line: string,
  expectedCommand: ClawasCommsCommand['type'],
): ClawasCommsResponse {
  const response: unknown = JSON.parse(line)
  const parsed = parseCommsResponse(response)
  if (parsed.command !== expectedCommand) {
    throw new Error(`response command ${parsed.command} does not match ${expectedCommand}`)
  }
  return parsed
}

async function sendRpcCommand(
  target: string,
  command: ClawasCommsCommand,
  timeout = 5_000,
): Promise<ClawasCommsResponse> {
  const socketPath = await resolveSocketPath(target)
  if (!socketPath) {
    throw new Error(`Unknown Clawas session target: ${target}`)
  }

  return await new Promise<ClawasCommsResponse>((resolve, reject) => {
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
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES)
        return fail(new Error('Clawas response exceeds frame limit'))
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
  const command: ClawasSendCommand = {
    type: 'send',
    message: options.message,
    mode: options.mode,
    messageType: options.messageType,
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

function isUnreachable(error: unknown): boolean {
  return (
    error instanceof Error &&
    (('code' in error &&
      ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(String(error.code))) ||
      error.message === 'timeout' ||
      error.message.includes('closed without a response'))
  )
}

export async function getClawasSessionStatus(target: string): Promise<ClawasSessionStatus | null> {
  try {
    const response = await sendRpcCommand(target, { type: 'get_status' }, 1_000)
    if (!response.success) throw new Error(response.error ?? 'Clawas get_status failed')
    return parseSessionStatusData(response.data)
  } catch (error) {
    if (
      isUnreachable(error) ||
      (error instanceof Error && error.message.startsWith('Unknown Clawas session target:'))
    )
      return null
    throw error
  }
}

export async function getClawasLastMessage(target: string): Promise<ClawasExtractedMessage | null> {
  try {
    const response = await sendRpcCommand(target, { type: 'get_message' }, 1_000)
    if (!response.success) throw new Error(response.error ?? 'Clawas get_message failed')
    return parseLastMessageData(response.data)
  } catch (error) {
    if (
      isUnreachable(error) ||
      (error instanceof Error && error.message.startsWith('Unknown Clawas session target:'))
    )
      return null
    throw error
  }
}

function readStatusFrame(line: string, initial: boolean): ClawasSessionStatus {
  const frame: unknown = JSON.parse(line)
  if (initial) {
    const response = parseCommsResponse(frame)
    if (response.command !== 'subscribe_status' || !response.success)
      throw new Error(response.error ?? 'Subscription rejected')
    return parseSessionStatusData(response.data)
  }
  if (
    !frame ||
    typeof frame !== 'object' ||
    !('type' in frame) ||
    frame.type !== 'status' ||
    !('status' in frame)
  )
    throw new Error('Invalid status event')
  return parseSessionStatusData(frame.status)
}

export async function watchClawasSession(
  target: string,
  callbacks: { onStatus(status: ClawasSessionStatus): void; onClose(error: Error): void },
): Promise<{ close(): void }> {
  const socketPath = await resolveSocketPath(target)
  if (!socketPath) throw new Error(`Unknown Clawas session target: ${target}`)
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setEncoding('utf8')
    let buffer = ''
    let ready = false
    let closed = false
    const timeout = setTimeout(
      () => socket.destroy(new Error('Clawas subscription timed out')),
      5_000,
    )
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      socket.destroy()
    }
    const fail = (error: Error) => {
      if (closed) return
      close()
      if (!ready) {
        reject(error)
        return
      }
      try {
        callbacks.onClose(error)
      } catch (callbackError) {
        console.error('Clawas status close handler failed:', callbackError)
      }
    }
    const receiveLine = (line: string) => {
      try {
        const initial = !ready
        callbacks.onStatus(readStatusFrame(line, initial))
        if (initial) {
          ready = true
          clearTimeout(timeout)
          resolve({ close })
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
    socket.on('connect', () => socket.write('{"type":"subscribe_status"}\n'))
    socket.on('data', (chunk: string) => {
      if (closed) return
      buffer += chunk
      if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES)
        return fail(new Error('Clawas status frame exceeds limit'))
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        receiveLine(line)
        if (closed) return
        newline = buffer.indexOf('\n')
      }
    })
    socket.on('error', fail)
    socket.on('end', () => fail(new Error(`Clawas session ${target} closed`)))
    socket.on('close', () => fail(new Error(`Clawas session ${target} closed`)))
  })
}
