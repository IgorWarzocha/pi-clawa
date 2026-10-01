import { isDeepStrictEqual } from 'node:util'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  ContextAgentIdentity,
  ContextSharingService,
  connectCodexContextSharing,
  SharedContextRequest,
  SharedContextResult,
} from '@howaboua/pi-codex-conversion/context-sharing'
import { requestClawasContext } from './comms/client.js'
import {
  type ClawasContextCommand,
  type ContextMember,
  parseContextIdentity,
  parseContextMember,
  parseContextRequest,
  parseContextResult,
  parseParentContextRoute,
  type SharedResidentContext,
} from './comms/context-protocol.js'
import type { ClawasSessionStatus } from './comms/types.js'

const MEMBER_ENTRY = 'clawa-context-child'
const UNSAFE_CONTEXT_NAME = /[^a-zA-Z0-9_-]+/gu

export type PrepareResidentContext = (
  workerId: string,
) => Promise<{ accept(status: ClawasSessionStatus): Promise<SharedResidentContext> } | undefined>

function hasClawaRoute(identity: ContextAgentIdentity): boolean {
  const routing = identity.routing
  return (
    typeof routing === 'object' &&
    routing !== null &&
    'transport' in routing &&
    routing.transport === 'clawa'
  )
}

/** Optional Codex identities and operations travel over Clawa's existing resident sockets. */
export class ClawaContextSharing {
  private readonly pi: ExtensionAPI
  private readonly isActive: () => boolean
  private connection: ReturnType<typeof connectCodexContextSharing> | undefined
  private unregisterRouter: (() => void) | undefined
  private lifetime = new AbortController()
  private generation = 0
  private running = false

  constructor(pi: ExtensionAPI, isActive: () => boolean) {
    this.pi = pi
    this.isActive = isActive
  }

  async register(): Promise<void> {
    try {
      import.meta.resolve('@howaboua/pi-codex-conversion/context-sharing')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return
      throw error
    }
    const api = await import('@howaboua/pi-codex-conversion/context-sharing')
    this.connection = api.connectCodexContextSharing(this.pi)
    this.pi.on('session_start', (_event, ctx) => this.restore(ctx))
    this.pi.on('before_agent_start', (_event, ctx) => this.restore(ctx))
    this.pi.on('agent_start', () => {
      this.running = true
    })
    this.pi.on('agent_settled', () => {
      this.running = false
    })
    this.pi.on('session_shutdown', () => this.connection?.dispose())
  }

  detach(): void {
    this.generation += 1
    this.lifetime.abort()
    this.lifetime = new AbortController()
    this.running = false
    this.unregisterRouter?.()
    this.unregisterRouter = undefined
  }

  describe(ctx: ExtensionContext): SharedResidentContext | undefined {
    if (!this.isActive()) return undefined
    const identity = this.connection?.service?.describe(ctx)
    return identity ? { sessionId: identity.sessionId, agentName: identity.agentName } : undefined
  }

  private members(ctx: ExtensionContext, identity: ContextAgentIdentity): ContextMember[] {
    return ctx.sessionManager.getEntries().flatMap((entry) => {
      if (entry.type !== 'custom' || entry.customType !== MEMBER_ENTRY) return []
      const member = parseContextMember(entry.data)
      return member.parentThreadId === identity.threadId && member.sessionId === identity.sessionId
        ? [member]
        : []
    })
  }

  private restore(ctx: ExtensionContext): void {
    if (!this.isActive()) return
    const service = this.connection?.service
    const identity = service?.describe(ctx)
    if (
      service &&
      identity?.storage === 'session' &&
      (hasClawaRoute(identity) || this.members(ctx, identity).length > 0)
    ) {
      try {
        this.ensureRouter(service)
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'warning')
      }
    }
  }

  private ensureRouter(service: ContextSharingService): void {
    if (this.unregisterRouter) return
    try {
      this.unregisterRouter = service.registerRouter((ctx, request, signal) =>
        this.route(ctx, parseContextRequest(request), [], signal),
      )
    } catch (error) {
      throw new Error(
        'Clawa context sharing cannot replace another extension’s Codex router. Disable the other peer router or turn off Codex subagent sharing for this launch.',
        { cause: error },
      )
    }
  }

  private assertCurrent(ctx: ExtensionContext, threadId: string, generation: number): void {
    if (
      !this.isActive() ||
      this.generation !== generation ||
      ctx.sessionManager.getSessionId() !== threadId
    )
      throw new Error('Clawa session changed during context sharing')
  }

  async prepare(ctx: ExtensionContext, workerId: string): ReturnType<PrepareResidentContext> {
    if (!this.isActive()) throw new Error('Clawa is not active in this session')
    const service = this.connection?.service
    if (!service?.canCreateChild(ctx)) return undefined
    const parent = service.describe(ctx)
    if (!parent) return undefined
    const generation = this.generation
    const signal = this.lifetime.signal
    if (parent.storage === 'session') this.ensureRouter(service)
    const { binding, adopt } = await service.createChild(ctx, {
      // Codex adds a unique suffix. Normalize only its path segment, never the resident ID.
      name: workerId.replace(UNSAFE_CONTEXT_NAME, '_'),
      ...(parent.storage === 'session'
        ? { routing: { transport: 'clawa', parentThreadId: parent.threadId } }
        : {}),
    })
    this.assertCurrent(ctx, parent.threadId, generation)
    return {
      accept: async (status) => {
        this.assertCurrent(ctx, parent.threadId, generation)
        const identity = parseContextIdentity(
          await requestClawasContext(
            status.sessionId,
            {
              type: 'context',
              operation: 'bind',
              sessionId: status.sessionId,
              binding,
            },
            signal,
          ),
        )
        if (
          identity.threadId !== status.sessionId ||
          identity.sessionId !== binding.sessionId ||
          identity.agentName !== binding.agentName ||
          identity.storage !== binding.storage ||
          identity.accountScope !== binding.accountScope ||
          !isDeepStrictEqual(identity.routing, binding.routing)
        )
          throw new Error('Resident did not accept its Codex context identity and route')
        this.assertCurrent(ctx, parent.threadId, generation)
        await adopt()
        this.assertCurrent(ctx, parent.threadId, generation)
        this.pi.appendEntry<ContextMember>(MEMBER_ENTRY, {
          parentThreadId: parent.threadId,
          childThreadId: identity.threadId,
          sessionId: identity.sessionId,
          agentName: identity.agentName,
        })
        return { sessionId: identity.sessionId, agentName: identity.agentName }
      },
    }
  }

  async handle(
    ctx: ExtensionContext,
    command: ClawasContextCommand,
    signal: AbortSignal,
  ): Promise<ContextAgentIdentity | SharedContextResult> {
    signal.throwIfAborted()
    if (!this.isActive()) throw new Error('Clawa is not active in this session')
    const service = this.connection?.service
    const identity = service?.describe(ctx)
    if (!(service && identity))
      throw new Error(
        'This resident needs Pi Codex with notes-based continuity to share context. Enable it in the resident home, or disable subagent sharing in the main session.',
      )
    if (command.operation === 'execute')
      return this.route(ctx, command.request, command.visited, signal)
    if (command.sessionId !== ctx.sessionManager.getSessionId())
      throw new Error('Resident session changed before context binding')
    const generation = this.generation
    if (identity.storage === 'session') this.ensureRouter(service)
    const bound = await service.bind(ctx, command.binding)
    this.assertCurrent(ctx, command.sessionId, generation)
    signal.throwIfAborted()
    return bound
  }

  private async route(
    ctx: ExtensionContext,
    request: SharedContextRequest,
    visited: string[],
    signal?: AbortSignal,
  ): Promise<SharedContextResult> {
    signal?.throwIfAborted()
    if (!this.isActive()) throw new Error('Clawa is not active in this session')
    const service = this.connection?.service
    const identity = service?.describe(ctx)
    if (!(service && identity) || identity.storage !== 'session')
      throw new Error('Clawa peer routing requires active Local or Tree Codex continuity')
    if (
      request.sessionId !== identity.sessionId ||
      visited.length >= 63 ||
      visited.includes(identity.threadId)
    )
      throw new Error('Invalid Clawa context family or routing loop')
    if (identity.agentName === request.agentName) {
      if (!(ctx.isIdle() || this.running))
        throw new Error('Context owner is changing branches; retry after it settles')
      return service.execute(ctx, request, signal)
    }
    const child = this.members(ctx, identity).findLast(
      (member) =>
        request.agentName === member.agentName ||
        request.agentName.startsWith(`${member.agentName}/`),
    )
    const target =
      child?.childThreadId ??
      (hasClawaRoute(identity)
        ? parseParentContextRoute(identity.routing).parentThreadId
        : undefined)
    if (!target) throw new Error(`No Clawa context agent ${request.agentName} in this family`)
    return parseContextResult(
      await requestClawasContext(
        target,
        {
          type: 'context',
          operation: 'execute',
          request,
          visited: [...visited, identity.threadId],
        },
        signal,
      ),
    )
  }
}
