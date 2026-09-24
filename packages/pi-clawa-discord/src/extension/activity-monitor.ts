import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { type Component, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type {
  DiscordActivityDisposition,
  DiscordActivityEvent,
  DiscordConnectionState,
} from '../discord/activity.js'

interface ActivityMonitorState {
  connection: DiscordConnectionState
  botTag?: string | undefined
  chatEnabled: boolean
  triggerAliases: string[]
  lineCount: number
  entries: DiscordActivityEvent[]
}

const WIDGET_KEY = 'clawa-discord-activity'
const STORED_ENTRIES = 100

export class DiscordActivityMonitor {
  private readonly state: ActivityMonitorState = {
    connection: 'missing-token',
    chatEnabled: false,
    triggerAliases: [],
    lineCount: 6,
    entries: [],
  }
  private context: ExtensionContext | undefined
  private tui: TUI | undefined

  attach(context: ExtensionContext): void {
    this.clearSurface()
    this.context = context
    if (context.mode !== 'tui') return

    context.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      this.tui = tui
      return new ActivityPanel(theme, () => this.state)
    })
  }

  dispose(): void {
    this.clearSurface()
    this.context = undefined
  }

  configure(options: { chatEnabled: boolean; triggerAliases: string[]; lineCount: number }): void {
    this.state.chatEnabled = options.chatEnabled
    this.state.triggerAliases = [...options.triggerAliases]
    this.state.lineCount = options.lineCount
    this.render()
  }

  setConnection(connection: DiscordConnectionState, botTag?: string): void {
    this.state.connection = connection
    this.state.botTag = botTag
    this.render()
  }

  setChatEnabled(enabled: boolean): void {
    this.state.chatEnabled = enabled
    this.render()
  }

  record(event: DiscordActivityEvent): void {
    const existing = this.state.entries.findIndex((entry) => entry.id === event.id)
    if (existing >= 0) this.state.entries[existing] = event
    else this.state.entries.push(event)
    if (this.state.entries.length > STORED_ENTRIES) {
      this.state.entries.splice(0, this.state.entries.length - STORED_ENTRIES)
    }
    this.render()
  }

  mark(id: string, disposition: DiscordActivityDisposition): void {
    const entry = this.state.entries.find((candidate) => candidate.id === id)
    if (!entry) return
    entry.disposition = disposition
    this.render()
  }

  updateMessage(id: string, body: string): void {
    const entry = this.state.entries.find((candidate) => candidate.id === id)
    if (!entry) return
    entry.body = body
    this.render()
  }

  private clearSurface(): void {
    if (this.context?.mode === 'tui') this.context.ui.setWidget(WIDGET_KEY, undefined)
    this.tui = undefined
  }

  private render(): void {
    this.tui?.requestRender()
  }
}

class ActivityPanel implements Component {
  private readonly theme: Theme
  private readonly getState: () => ActivityMonitorState

  constructor(theme: Theme, getState: () => ActivityMonitorState) {
    this.theme = theme
    this.getState = getState
  }

  render(width: number): string[] {
    return renderActivity(this.getState(), this.theme, width).map((line) =>
      fillLine(line, width, this.theme),
    )
  }

  invalidate(): void {}
}

function renderActivity(state: ActivityMonitorState, theme: Theme, width: number): string[] {
  const connection = renderConnection(state, theme)
  const mode = state.chatEnabled
    ? theme.fg('success', `armed${renderAliases(state.triggerAliases)}`)
    : theme.fg('warning', 'monitor only')
  const lines = [
    truncateToWidth(` ${theme.bold(theme.fg('accent', 'Discord'))} · ${connection}`, width),
    truncateToWidth(` ${mode}${theme.fg('dim', ' · /discord')}`, width),
  ]
  const entries = state.entries.slice(-state.lineCount)
  if (entries.length === 0) {
    lines.push(truncateToWidth(` ${theme.fg('dim', 'Waiting for Discord activity')}`, width))
  } else {
    for (const entry of entries) lines.push(renderEntry(entry, theme, width))
  }
  lines.push(theme.fg('border', '─'.repeat(Math.max(0, width))))
  return lines
}

function renderConnection(state: ActivityMonitorState, theme: Theme): string {
  if (state.connection === 'connected') {
    return theme.fg('success', state.botTag ? `connected ${state.botTag}` : 'connected')
  }
  if (state.connection === 'failed') return theme.fg('error', 'connection failed')
  if (state.connection === 'connecting') return theme.fg('warning', 'connecting')
  if (state.connection === 'stopped') return theme.fg('dim', 'stopped')
  return theme.fg('warning', 'token missing')
}

function renderAliases(aliases: string[]): string {
  if (aliases.length === 0) return ''
  return ` · ${aliases.join('/')}`
}

function renderEntry(entry: DiscordActivityEvent, theme: Theme, width: number): string {
  const icon = dispositionIcon(entry.disposition, theme)
  const time = formatTime(entry.occurredAt)
  const body = entry.body.replace(/\s+/gu, ' ').trim() || '[no text]'
  return truncateToWidth(
    ` ${icon} ${theme.fg('dim', time)} ${entry.channelLabel} · ${entry.senderName}: ${body}`,
    width,
  )
}

function dispositionIcon(disposition: DiscordActivityDisposition, theme: Theme): string {
  if (disposition === 'queued') return theme.fg('accent', '→')
  if (disposition === 'active') return theme.fg('accent', '◆')
  if (disposition === 'replied') return theme.fg('success', '✓')
  if (disposition === 'handled') return theme.fg('dim', '○')
  if (disposition === 'paused') return theme.fg('warning', '║')
  if (disposition === 'full' || disposition === 'blocked') return theme.fg('error', '×')
  if (disposition === 'deleted') return theme.fg('dim', '⌫')
  return theme.fg('dim', '·')
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function fillLine(line: string, width: number, theme: Theme): string {
  const truncated = truncateToWidth(line, width)
  const padding = Math.max(0, width - visibleWidth(truncated))
  return theme.bg('customMessageBg', `${truncated}${' '.repeat(padding)}`)
}
