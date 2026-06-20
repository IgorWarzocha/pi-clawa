import type { ChildProcess } from 'node:child_process'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { attachJsonlLineReader, serializeJsonLine } from './jsonl.js'
import { isAgentEvent, isRpcResponse } from './rpc-guards.js'
import type { ClawasRpcCommand, ClawasRpcCommandInput, ClawasRpcResponse } from './rpc-types.js'

type PendingRequest = {
  resolve: (response: ClawasRpcResponse) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface RpcChannelOptions {
  workerId: string
  onEvent: (event: AgentEvent) => void
}

/**
 * JSONL transport for the worker RPC process.
 * It owns stdout parsing and request/response bookkeeping so the worker wrapper
 * can stay focused on process lifecycle and typed commands.
 */
export class ClawasRpcChannel {
  private readonly pending = new Map<string, PendingRequest>()
  private stopReadingStdout: (() => void) | null = null
  private nextRequestId = 0
  private readonly options: RpcChannelOptions

  constructor(options: RpcChannelOptions) {
    this.options = options
  }

  attach(process: ChildProcess): void {
    if (!process.stdout) {
      throw new Error(`Worker ${this.options.workerId} has no stdout pipe`)
    }

    this.stopReadingStdout = attachJsonlLineReader(process.stdout, (line) => {
      this.handleStdoutLine(line)
    })
  }

  detachWithError(reason: string): void {
    this.stopReadingStdout?.()
    this.stopReadingStdout = null

    for (const [requestId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(
        new Error(
          `Worker ${this.options.workerId} exited before responding to ${requestId}: ${reason}`,
        ),
      )
    }
    this.pending.clear()
  }

  async send(process: ChildProcess, command: ClawasRpcCommandInput): Promise<ClawasRpcResponse> {
    if (!process.stdin) {
      throw new Error(`Worker ${this.options.workerId} is not running`)
    }

    const id = `${this.options.workerId}-${this.nextRequestId++}`
    const request: ClawasRpcCommand = { ...command, id }

    return await new Promise<ClawasRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(`Timed out waiting for ${command.type} on worker ${this.options.workerId}`),
        )
      }, 30_000)

      this.pending.set(id, { resolve, reject, timeout })
      process.stdin?.write(serializeJsonLine(request))
    })
  }

  private handleStdoutLine(line: string): void {
    if (!line.trim()) {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }

    if (isRpcResponse(parsed)) {
      if (!parsed.id) {
        return
      }

      const pending = this.pending.get(parsed.id)
      if (!pending) {
        return
      }

      this.pending.delete(parsed.id)
      clearTimeout(pending.timeout)
      if (parsed.success) {
        pending.resolve(parsed)
      } else {
        pending.reject(new Error(parsed.error ?? `RPC command failed: ${parsed.command}`))
      }
      return
    }

    if (isAgentEvent(parsed)) {
      this.options.onEvent(parsed)
    }
  }
}
