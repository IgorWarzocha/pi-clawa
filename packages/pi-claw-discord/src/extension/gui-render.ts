import type { DiscordGuiItem, DiscordGuiMode, DiscordGuiSnapshot } from './gui-types.js'

export function renderDiscordGui(options: {
  snapshot: DiscordGuiSnapshot
  items: DiscordGuiItem[]
  selected: number
  mode: DiscordGuiMode
  input: string
  message: string
}): string[] {
  const { snapshot, items, selected, mode, input, message } = options
  if (mode === 'token') return renderTokenMode(input)
  if (mode === 'channel') return renderChannelMode(input)
  return renderMenuMode({ snapshot, items, selected, message })
}

function renderTokenMode(input: string): string[] {
  return [
    '╭─ Clawa Discord setup',
    '│ paste bot token, then Enter',
    `│ ${input ? '•'.repeat(Math.min(input.length, 48)) : 'token: '}`,
    '╰─ Enter save · Esc cancel',
  ]
}

function renderChannelMode(input: string): string[] {
  return [
    '╭─ Clawa Discord setup',
    '│ paste Discord channel id, then Enter',
    `│ ${input || 'channel id: '}`,
    '╰─ Enter save · Esc cancel',
  ]
}

function renderMenuMode(options: {
  snapshot: DiscordGuiSnapshot
  items: DiscordGuiItem[]
  selected: number
  message: string
}): string[] {
  const { snapshot, items, selected, message } = options
  const lines = [
    '╭─ Clawa Discord',
    `│ gateway ${snapshot.gatewayRunning ? 'running' : 'stopped'} · token ${snapshot.maskedToken}`,
    `│ channel ${snapshot.channelMap}`,
    `│ config ${snapshot.configPath}`,
  ]
  if (message) lines.push(`│ ${message}`)
  appendMenuItems(lines, items, selected)
  lines.push('╰─ ↑/↓ choose · Enter · Esc')
  return lines
}

function appendMenuItems(lines: string[], items: DiscordGuiItem[], selected: number): void {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) continue
    const marker = index === selected ? '›' : ' '
    lines.push(`│ ${marker} ${item.label} · ${item.detail}`)
  }
}
