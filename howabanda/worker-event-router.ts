import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { extractAssistantText } from './assistant-text.js'
import { getWorkerState, patchWorkerState, pushEvent } from './state.js'
import { summarizeAssistantText, summarizeError } from './summaries.js'
import type { HowabandaState, WorkerStatus } from './types.js'

interface WorkerEventRouterOptions {
  state: HowabandaState
  streamBuffers: Map<string, string>
  notifyChanged: () => void
  getNow?: () => number
}

/**
 * Keeps noisy event-transition logic out of the daemon lifecycle code.
 * The daemon owns workers; this router owns how worker events shape feed state.
 */
export class HowabandaWorkerEventRouter {
  private readonly getNow: () => number

  constructor(private readonly options: WorkerEventRouterOptions) {
    this.getNow = options.getNow ?? (() => Date.now())
  }

  handleEvent(workerId: string, event: AgentEvent): void {
    if (event.type === 'agent_start') {
      patchWorkerState(
        this.options.state,
        workerId,
        { status: 'streaming', lastError: undefined },
        this.getNow(),
      )
      this.options.notifyChanged()
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      const current = this.options.streamBuffers.get(workerId) ?? ''
      this.options.streamBuffers.set(workerId, current + event.assistantMessageEvent.delta)
      return
    }

    if (event.type === 'message_end') {
      const next = extractAssistantText(event.message)
      if (next) {
        this.options.streamBuffers.set(workerId, next)
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      patchWorkerState(
        this.options.state,
        workerId,
        { currentToolName: event.toolName },
        this.getNow(),
      )
      this.options.notifyChanged()
      return
    }

    if (event.type === 'tool_execution_end') {
      patchWorkerState(this.options.state, workerId, { currentToolName: undefined }, this.getNow())
      this.options.notifyChanged()
      return
    }

    if (event.type === 'agent_end') {
      const summary = summarizeAssistantText(this.options.streamBuffers.get(workerId) ?? '')
      this.options.streamBuffers.set(workerId, '')
      patchWorkerState(
        this.options.state,
        workerId,
        {
          status: 'idle',
          currentTask: undefined,
          currentToolName: undefined,
          lastSummary: summary || getWorkerState(this.options.state, workerId).lastSummary,
        },
        this.getNow(),
      )
      if (summary) {
        pushEvent(this.options.state, workerId, `${workerId} finished: ${summary}`, this.getNow())
      }
      this.options.notifyChanged()
    }
  }

  handleClose(
    workerId: string,
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string,
    stopping: boolean,
  ): void {
    this.options.streamBuffers.delete(workerId)

    const cleanSignal = signal === 'SIGTERM' || signal === 'SIGKILL'
    const status: WorkerStatus = stopping
      ? 'stopped'
      : code === 0 || (code === null && cleanSignal)
        ? 'stopped'
        : 'error'
    const exitDetail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    const lastError =
      status === 'error' ? summarizeError(stderr || `worker exited with ${exitDetail}`) : undefined
    patchWorkerState(
      this.options.state,
      workerId,
      {
        status,
        pid: undefined,
        currentTask: undefined,
        currentToolName: undefined,
        lastError,
      },
      this.getNow(),
    )
    pushEvent(
      this.options.state,
      workerId,
      status === 'error'
        ? `${workerId} exited: ${lastError}`
        : `${workerId} stopped${signal ? ` (${signal})` : ''}`,
      this.getNow(),
    )
    this.options.notifyChanged()
  }
}
