import { readFileSync } from 'node:fs'
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from '@earendil-works/pi-coding-agent'
import { AmbientJitter } from './bridge/ambient-jitter.js'
import { extractAssistantError, extractAssistantText } from './bridge/assistant-text.js'
import { selectDiscordContext } from './bridge/context-selection.js'
import type { DiscordBridgeState, DiscordInboundTurn } from './bridge/contracts.js'
import { buildDiscordPrompt, buildDiscordSystemPrompt } from './bridge/prompt.js'
import {
  buildDiscordRoutes,
  DiscordRouteRegistry,
  MESSAGE_ROUTE_ENTRY_TYPE,
  restoreDiscordRoutes,
} from './bridge/routes.js'
import { DiscordSessionOutput } from './bridge/session-output.js'
import { DiscordTurnCoordinator } from './bridge/turn-coordinator.js'
import { type DiscordConfig, loadConfig, writeConfigValue } from './config.js'
import type { DiscordConnectionState } from './discord/activity.js'
import { DiscordClientRuntime } from './discord/client.js'
import { acquireBotConnection } from './discord/connection-lease.js'
import type { DiscordActivityMonitor } from './extension/activity-monitor.js'

/** One native Pi session owns one home-local bot connection and its turn queue. */
export class DiscordSession {
  readonly config: DiscordConfig
  readonly output: DiscordSessionOutput
  private readonly ambient: AmbientJitter
  private readonly bridge: DiscordTurnCoordinator
  private readonly monitor: DiscordActivityMonitor
  private readonly pi: ExtensionAPI
  private readonly routes: DiscordRouteRegistry
  private configSnapshot: string
  private runtime: DiscordClientRuntime | undefined
  private releaseConnection: (() => void) | undefined
  private context: ExtensionContext
  private activePromptTurns: readonly DiscordInboundTurn[] | undefined
  private bridgeState: DiscordBridgeState = { active: [], queued: 0 }
  private connection: DiscordConnectionState = 'missing-token'
  private archiveFailure: string | undefined
  private uiBlocked = false

  constructor(pi: ExtensionAPI, context: ExtensionContext, monitor: DiscordActivityMonitor) {
    this.pi = pi
    this.context = context
    this.monitor = monitor
    this.config = loadConfig(context.cwd)
    this.configSnapshot = readFileSync(this.config.configPath, 'utf8')
    this.routes = new DiscordRouteRegistry(restoreDiscordRoutes(context), (route) => {
      pi.appendEntry(MESSAGE_ROUTE_ENTRY_TYPE, route)
    })
    this.output = new DiscordSessionOutput(this.routes, () => this.bridge.activeTurns, {
      runtime: () => this.runtime,
      report: (message, level) => this.report(message, level),
      completed: (id, replied) => monitor.mark(id, replied ? 'replied' : 'handled'),
    })
    this.bridge = new DiscordTurnCoordinator(
      {
        isIdle: () => !this.uiBlocked && this.context.isIdle(),
        showTurns: (turns) => this.showTurns(turns),
        deliverOutput: (turns, text) => this.output.deliver(turns, text),
        startTyping: (channelId) => this.runtime?.startTyping(channelId) ?? (() => {}),
        report: (message, level) => this.report(message, level),
        stateChanged: (state) => {
          this.bridgeState = state
          for (const turn of state.active) monitor.mark(turn.id, 'active')
          this.updateStatus()
        },
      },
      this.config.maxQueue,
    )
    this.ambient = new AmbientJitter({
      minMessages: this.config.ambientWakeMinMessages,
      maxMessages: this.config.ambientWakeMaxMessages,
      enqueue: (turns) => this.bridge.enqueueBatch(turns),
    })
    monitor.configure({
      chatEnabled: this.config.discordChatEnabled,
      triggerAliases: this.config.triggerAliases,
      lineCount: this.config.discordActivityLines,
    })
  }

  async start(): Promise<void> {
    if (!this.config.token) return
    this.monitor.attach(this.context)
    this.connection = 'connecting'
    this.monitor.setConnection(this.connection)
    this.updateStatus()
    try {
      this.releaseConnection = acquireBotConnection(this.config.token)
      this.runtime = new DiscordClientRuntime(this.config, {
        chatEnabled: () => this.config.discordChatEnabled,
        observeActivity: (event) => this.monitor.record(event),
        updateActivity: (id, body) => this.monitor.updateMessage(id, body),
        deleteActivity: (id) => this.monitor.mark(id, 'deleted'),
        enqueue: (turn) => {
          const queued = this.bridge.enqueue(turn)
          if (queued) this.ambient.reset(turn.channelId)
          return queued
        },
        enqueueAmbient: (turn) => this.offerAmbient(turn),
        updatePending: (id, body) =>
          this.ambient.updatePending(id, body) || this.bridge.updatePending(id, body),
        removePending: (id) => this.ambient.removePending(id) || this.bridge.removePending(id),
        describeStatus: () => this.describeStatus(),
        report: (message, level) => this.report(message, level),
        archiveHealth: (failure) => {
          if (failure === this.archiveFailure) return
          this.archiveFailure = failure
          this.updateStatus()
          this.report(failure ?? 'Discord archive recovered.', failure ? 'error' : 'info')
        },
        connected: (tag) => {
          this.connection = 'connected'
          this.monitor.setConnection(this.connection, tag)
          this.updateStatus()
          this.report(`Discord connected as ${tag}.`, 'info')
        },
      })
      await this.runtime.start()
    } catch (error) {
      try {
        await this.runtime?.stop()
      } finally {
        this.runtime = undefined
        this.releaseConnection?.()
        this.releaseConnection = undefined
        this.connection = 'failed'
        this.monitor.setConnection(this.connection)
        this.updateStatus()
      }
      this.report(`Discord connection failed: ${String(error)}`, 'error')
    }
  }

  async stop(): Promise<void> {
    this.uiBlocked = true
    this.activePromptTurns = undefined
    this.ambient.clear()
    this.bridge.stop()
    this.output.stop()
    try {
      await this.runtime?.stop()
    } finally {
      this.runtime = undefined
      this.releaseConnection?.()
      this.releaseConnection = undefined
      this.connection = 'stopped'
      this.monitor.setConnection(this.connection)
      this.monitor.dispose()
      this.context.ui.setStatus('clawa-discord', undefined)
    }
  }

  setUiBlocked(blocked: boolean, context: ExtensionContext): void {
    this.context = context
    this.uiBlocked = blocked
    if (!blocked) this.bridge.wake()
  }

  capture(message: MessageEndEvent['message']): void {
    if (message.role === 'assistant') {
      this.bridge.captureAssistant(extractAssistantText(message), extractAssistantError(message))
    }
  }

  async settle(context: ExtensionContext): Promise<void> {
    this.context = context
    const completed = this.activePromptTurns
    await this.bridge.settle()
    if (this.activePromptTurns === completed) this.activePromptTurns = undefined
  }

  getDiscordSystemPrompt(context: ExtensionContext): string | undefined {
    this.context = context
    const turns = this.activePromptTurns ?? this.bridge.activeTurns
    return turns.length > 0 ? buildDiscordSystemPrompt(turns, this.routes) : undefined
  }

  hasConfigChanged(): boolean {
    return readFileSync(this.config.configPath, 'utf8') !== this.configSnapshot
  }

  get chatEnabled(): boolean {
    return this.config.discordChatEnabled
  }

  setChatEnabled(enabled: boolean): void {
    writeConfigValue(this.config.configPath, 'DISCORD_CHAT_ENABLED', String(enabled))
    this.configSnapshot = readFileSync(this.config.configPath, 'utf8')
    this.config.discordChatEnabled = enabled
    this.monitor.setChatEnabled(enabled)
    if (enabled) this.bridge.wake()
    else {
      this.ambient.clear()
      for (const turn of this.bridge.drainPending()) this.monitor.mark(turn.id, 'paused')
    }
    this.updateStatus()
  }

  describeStatus(): string {
    return [
      `Discord: ${this.connection}`,
      `Bot: ${this.runtime?.tag ?? 'not connected'}`,
      `History: ${this.archiveFailure ?? 'healthy'}`,
      `Chat: ${this.chatEnabled ? 'armed' : 'monitor only'}`,
      'Ambient wake: ' +
        (this.config.ambientWakeEnabled
          ? this.config.ambientWakeMinMessages +
            '-' +
            this.config.ambientWakeMaxMessages +
            ' messages'
          : 'off'),
      `Pi: ${this.bridgeState.active.length} active, ${this.bridgeState.queued} queued`,
    ].join('\n')
  }

  private showTurns(turns: readonly DiscordInboundTurn[]): void {
    const model = this.context.model
    if (!(model && this.context.modelRegistry.hasConfiguredAuth(model))) {
      throw new Error('Select an authenticated Pi model before running Discord turns.')
    }
    const promptTurns = selectDiscordContext(turns, this.routes)
    const routes = buildDiscordRoutes(promptTurns, this.routes)
    this.activePromptTurns = promptTurns
    const content = buildDiscordPrompt(promptTurns, routes)
    // A real user kickoff runs Pi's preparation hooks; custom triggerTurn bypasses them.
    this.pi.sendUserMessage(content)
  }

  private offerAmbient(turn: DiscordInboundTurn): void {
    if (!this.config.ambientWakeEnabled) return
    const result = this.ambient.offer(turn)
    if (result.status === 'waiting') return
    const activeIds = new Set(this.bridge.activeTurns.map((active) => active.id))
    for (const offered of result.turns) {
      this.monitor.mark(
        offered.id,
        result.status === 'full' ? 'full' : activeIds.has(offered.id) ? 'active' : 'queued',
      )
    }
  }

  private updateStatus(): void {
    if (!(this.context.hasUI && this.config.token)) return
    const active = this.bridgeState.active.length > 0 ? 'replying' : 'idle'
    const color =
      this.archiveFailure || this.connection === 'failed'
        ? 'error'
        : this.connection === 'connected'
          ? 'success'
          : 'warning'
    this.context.ui.setStatus(
      'clawa-discord',
      this.context.ui.theme.fg(
        color,
        'Discord ' +
          this.connection +
          ' · ' +
          active +
          (this.bridgeState.queued ? ` · ${this.bridgeState.queued} queued` : '') +
          (this.archiveFailure ? ' · ARCHIVE FAILED' : ''),
      ),
    )
  }

  private report(message: string, level: 'info' | 'warning' | 'error'): void {
    this.context.ui.notify(message, level)
  }
}
