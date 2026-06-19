import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  CHANNEL_PREFIX_REGEX,
  DISCORD_WORKER_ID,
  GATEWAY_SOURCE_DIR,
  INPUT_CLEAN_NEWLINES_REGEX,
  INPUT_NEWLINE_REGEX,
  SETUP_DOC_PATH,
} from './constants.js'
import { ensureDiscordConfig, maskSecret, readEnvFile, writeEnvValue } from './env-file.js'
import { restartGateway, stopGateway } from './gateway.js'
import { isGatewayRunning } from './gateway-state.js'

type DiscordGuiAction = 'guide' | 'token' | 'channel' | 'restart' | 'stop' | 'close'
type DiscordGuiMode = 'menu' | 'token' | 'channel'
type DiscordGuiItem = {
  action: DiscordGuiAction
  label: string
  detail: string
}
type DiscordGuiSnapshot = {
  projectRoot: string
  configPath: string
  tokenSet: boolean
  maskedToken: string
  channelMap: string
  gatewayRunning: boolean
}
type CustomView = {
  render: (width: number) => string[]
  invalidate: () => void
  handleInput: (data: string) => void
}

function buildDiscordSnapshot(projectRoot: string): DiscordGuiSnapshot {
  const configPath = ensureDiscordConfig(projectRoot)
  const config = readEnvFile(configPath)
  const token = config.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN
  return {
    projectRoot,
    configPath,
    tokenSet: Boolean(token?.trim()),
    maskedToken: maskSecret(token),
    channelMap: config.CLAWAS_CHANNEL_WORKERS?.trim() || 'missing',
    gatewayRunning: isGatewayRunning(),
  }
}

function buildDiscordGuiItems(snapshot: DiscordGuiSnapshot): DiscordGuiItem[] {
  return [
    {
      action: 'guide',
      label: 'ask Clawa to guide setup',
      detail: 'sends setup prompt with paths',
    },
    {
      action: 'token',
      label: snapshot.tokenSet ? 'replace bot token' : 'set bot token',
      detail: snapshot.maskedToken,
    },
    {
      action: 'channel',
      label: 'set Discord channel',
      detail: snapshot.channelMap,
    },
    {
      action: 'restart',
      label: snapshot.gatewayRunning ? 'restart gateway' : 'start gateway',
      detail: snapshot.tokenSet ? 'uses saved config' : 'needs token first',
    },
    {
      action: 'stop',
      label: 'stop gateway',
      detail: snapshot.gatewayRunning ? 'running' : 'already stopped',
    },
    { action: 'close', label: 'close', detail: 'leave setup' },
  ]
}

function sanitizeChannelId(input: string): string {
  return input.trim().replace(CHANNEL_PREFIX_REGEX, '')
}

function buildDiscordSetupGuidePrompt(): string {
  return [
    'I would like to set up a Discord bot for this Clawa environment.',
    '',
    `Here are the precise instructions how to do it: ${SETUP_DOC_PATH}`,
    '',
    `Here is the source code for the Discord gateway if you get stuck: ${GATEWAY_SOURCE_DIR}`,
    '',
    'Guide me through it step by step. Ask for one thing at a time. Do not assume I know the Discord developer portal.',
  ].join('\n')
}

function renderDiscordGui(options: {
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
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) continue
    const marker = index === selected ? '›' : ' '
    lines.push(`│ ${marker} ${item.label} · ${item.detail}`)
  }
  lines.push('╰─ ↑/↓ choose · Enter · Esc')
  return lines
}

export async function runDiscordGui(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  projectRoot: string,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(`Discord config: ${ensureDiscordConfig(projectRoot)}`, 'info')
    return
  }

  await ctx.ui.custom<void>((tui, _theme, _keys, done): CustomView => {
    let snapshot = buildDiscordSnapshot(projectRoot)
    let items = buildDiscordGuiItems(snapshot)
    let selected = 0
    let mode: DiscordGuiMode = 'menu'
    let input = ''
    let message = ''

    const refresh = () => {
      snapshot = buildDiscordSnapshot(projectRoot)
      items = buildDiscordGuiItems(snapshot)
      selected = Math.min(selected, items.length - 1)
      tui.requestRender()
    }

    const saveInput = () => {
      const value = input.trim()
      input = ''
      if (!value) {
        message = 'nothing saved'
        mode = 'menu'
        refresh()
        return
      }
      saveDiscordInput({ mode, value, configPath: snapshot.configPath })
      message = mode === 'token' ? 'token saved' : 'channel mapped to discord-clawa'
      mode = 'menu'
      refresh()
    }

    const openInputMode = (nextMode: 'token' | 'channel') => {
      mode = nextMode
      input = ''
      message = ''
      tui.requestRender()
    }

    const runGatewayAction = (action: 'restart' | 'stop') => {
      if (action === 'restart') {
        restartGateway(projectRoot, ctx)
        message = snapshot.tokenSet ? 'gateway started' : 'token needed before gateway can start'
      } else {
        stopGateway()
        message = 'gateway stopped'
      }
      refresh()
    }

    const actionHandlers: Record<DiscordGuiAction, () => void> = {
      guide: () => {
        pi.sendUserMessage(buildDiscordSetupGuidePrompt())
        ctx.ui.notify('Sent Discord setup guide prompt.', 'info')
        done()
      },
      close: done,
      token: () => openInputMode('token'),
      channel: () => openInputMode('channel'),
      restart: () => runGatewayAction('restart'),
      stop: () => runGatewayAction('stop'),
    }

    const activate = () => {
      const item = items[selected]
      if (!item) return
      actionHandlers[item.action]()
    }

    return {
      render: () => renderDiscordGui({ snapshot, items, selected, mode, input, message }),
      invalidate: refresh,
      handleInput(data: string) {
        if (
          handleEscape({
            data,
            mode,
            setMode: (value) => (mode = value),
            done,
            render: tui.requestRender,
          })
        ) {
          input = ''
          return
        }
        if (mode !== 'menu') {
          const result = handleTextInput({ data, input, render: tui.requestRender })
          input = result.input
          if (result.save) saveInput()
          return
        }
        const next = handleMenuInput({ data, selected, max: items.length - 1, activate })
        if (next !== selected) {
          selected = next
          tui.requestRender()
        }
      },
    }
  })
}

function saveDiscordInput(options: {
  mode: DiscordGuiMode
  value: string
  configPath: string
}): void {
  const { mode, value, configPath } = options
  if (mode === 'token') {
    writeEnvValue(configPath, 'DISCORD_BOT_TOKEN', value)
    return
  }
  if (mode === 'channel') {
    const channelId = sanitizeChannelId(value)
    writeEnvValue(configPath, 'CLAWAS_CHANNEL_WORKERS', `${channelId}=${DISCORD_WORKER_ID}`)
  }
}

function handleEscape(options: {
  data: string
  mode: DiscordGuiMode
  setMode: (mode: DiscordGuiMode) => void
  done: () => void
  render: () => void
}): boolean {
  const { data, mode, setMode, done, render } = options
  if (data !== '\u001b') return false
  if (mode === 'menu') done()
  else {
    setMode('menu')
    render()
  }
  return true
}

function handleTextInput(options: { data: string; input: string; render: () => void }): {
  input: string
  save: boolean
} {
  const { data, input, render } = options
  const newlineIndex = data.search(INPUT_NEWLINE_REGEX)
  if (newlineIndex >= 0) {
    return { input: input + data.slice(0, newlineIndex), save: true }
  }
  if (data === '\r' || data === '\n') {
    return { input, save: true }
  }
  if (data === '\u007f' || data === '\b') {
    const next = input.slice(0, -1)
    render()
    return { input: next, save: false }
  }
  const next = input + data.replace(INPUT_CLEAN_NEWLINES_REGEX, '')
  render()
  return { input: next, save: false }
}

function handleMenuInput(options: {
  data: string
  selected: number
  max: number
  activate: () => void
}): number {
  const { data, selected, max, activate } = options
  if (data === '\r' || data === '\n') {
    activate()
    return selected
  }
  if (data === '\u001b[A' || data === 'k') return Math.max(0, selected - 1)
  if (data === '\u001b[B' || data === 'j') return Math.min(max, selected + 1)
  return selected
}
