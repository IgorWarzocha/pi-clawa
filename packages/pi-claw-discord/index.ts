import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { getLastDiscordSourceMessageId } from '@howaboua/pi-claw/clawas/comms/message-extract'
import { publishClawasDeliveryMessage } from '@howaboua/pi-claw/clawas/comms/outbound'
import { normalizeDiscordReplyText } from '@howaboua/pi-claw/clawas/comms/report-back-helpers'
import { getClawasConfigPath } from '@howaboua/pi-claw/clawas/config-loader'
import { findRepoRoot, resolveClawaDefaults } from '@howaboua/pi-claw/config'
import { Type } from 'typebox'

const extensionDir = dirname(fileURLToPath(import.meta.url))
const DISCORD_WORKER_ID = 'discord-clawa'
const DISCORD_WORKER_TITLE = 'Discord Clawa'
const DISCORD_WORKER_CWD = 'clawas/discord-clawa'
const DISCORD_CONFIG_RELATIVE = join('.pi', 'claw-discord', 'config.env')
const DISCORD_DATA_RELATIVE = join('.pi', 'claw-discord')
const GATEWAY_ENTRY = join(extensionDir, 'src', 'gateway', 'cli', 'index.ts')
const SETUP_DOC_PATH = join(extensionDir, 'DISCORD-BOT-SETUP.md')
const GATEWAY_SOURCE_DIR = join(extensionDir, 'src', 'gateway')
const LINE_SPLIT_REGEX = /\r?\n/
const TRAILING_NEWLINES_REGEX = /\n*$/
const CHANNEL_PREFIX_REGEX = /^dc:/
const INPUT_NEWLINE_REGEX = /[\r\n]/
const TOKEN_VISIBLE_PREFIX = 6
const TOKEN_VISIBLE_SUFFIX = 4

let gatewayProcess: ChildProcess | null = null
let gatewayConfigPath: string | null = null

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

function maskSecret(value: string | undefined): string {
  const token = value?.trim() ?? ''
  if (!token) return 'missing'
  if (token.length <= TOKEN_VISIBLE_PREFIX + TOKEN_VISIBLE_SUFFIX) return 'set'
  return `${token.slice(0, TOKEN_VISIBLE_PREFIX)}…${token.slice(-TOKEN_VISIBLE_SUFFIX)}`
}

function isGatewayRunning(): boolean {
  return Boolean(gatewayProcess && !gatewayProcess.killed)
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const out: Record<string, string> = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(LINE_SPLIT_REGEX)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals === -1) continue
    out[line.slice(0, equals).trim()] = line.slice(equals + 1).trim()
  }
  return out
}

function writeEnvValue(filePath: string, key: string, value: string): void {
  const existing = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').split(LINE_SPLIT_REGEX)
    : []
  let replaced = false
  const lines = existing.map((line) => {
    if (line.trimStart().startsWith('#')) return line
    const equals = line.indexOf('=')
    if (equals === -1) return line
    if (line.slice(0, equals).trim() !== key) return line
    replaced = true
    return `${key}=${value}`
  })

  if (!replaced) lines.push(`${key}=${value}`)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${lines.join('\n').replace(TRAILING_NEWLINES_REGEX, '')}\n`, 'utf8')
}

function writeDefaultDiscordConfig(projectRoot: string, configPath: string): void {
  const clawa = resolveClawaDefaults(projectRoot)
  const content = [
    '# Clawa Discord gateway config.',
    '# Fill DISCORD_BOT_TOKEN and CLAWAS_CHANNEL_WORKERS, then restart Pi.',
    `DISCORD_BOT_TOKEN=${process.env.DISCORD_BOT_TOKEN ?? ''}`,
    'CHANNEL_POLICY=allowlist',
    'TRIGGER_NAME=clawa',
    'TRIGGER_ALIASES=claw,clawa',
    'PI_CWD=.',
    `DB_PATH=${join(DISCORD_DATA_RELATIVE, 'gateway.db')}`,
    `SESSIONS_DIR=${join(DISCORD_DATA_RELATIVE, 'sessions')}`,
    'PI_CLAWAS_CONTROL_SOCKET_ROOT=.pi',
    `PI_CLAWAS_CONTROL_SOCKET_DIR=${clawa.controlSocketDir}`,
    '# Example: CLAWAS_CHANNEL_WORKERS=123456789012345678=discord-clawa',
    `CLAWAS_CHANNEL_WORKERS=${process.env.CLAWAS_CHANNEL_WORKERS ?? ''}`,
    'MAX_CONCURRENCY=3',
    'ENABLE_SCHEDULER=false',
    '',
  ].join('\n')

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, content, 'utf8')
}

function ensureDiscordConfig(projectRoot: string): string {
  const configPath = resolve(projectRoot, DISCORD_CONFIG_RELATIVE)
  if (!existsSync(configPath)) writeDefaultDiscordConfig(projectRoot, configPath)
  gatewayConfigPath = configPath
  return configPath
}

function projectRelativePath(projectRoot: string, targetPath: string): string {
  return relative(projectRoot, targetPath) || targetPath
}

async function copyDiscordWorkerTemplates(targetDir: string): Promise<void> {
  const templateDir = join(extensionDir, 'templates', 'discord-worker')
  await mkdir(targetDir, { recursive: true })
  for (const file of [
    'AGENTS.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
    'MEMORY.md',
    'CURIOUS.md',
  ]) {
    await copyFile(join(templateDir, file), join(targetDir, file))
  }
}

function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
}

async function loadClawasConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(stripJsonc(await readFile(configPath, 'utf8'))) as Record<string, unknown>
  } catch {
    return { workers: [] }
  }
}

async function ensureDiscordWorker(projectRoot: string): Promise<void> {
  const configPath = getClawasConfigPath(projectRoot)
  const config = await loadClawasConfig(configPath)
  const workers = Array.isArray(config.workers) ? [...config.workers] : []
  const adapterExtension = projectRelativePath(projectRoot, fileURLToPath(import.meta.url))
  const existingIndex = workers.findIndex((entry) => {
    return Boolean(
      entry && typeof entry === 'object' && (entry as { id?: unknown }).id === DISCORD_WORKER_ID,
    )
  })
  const current = existingIndex >= 0 ? (workers[existingIndex] as Record<string, unknown>) : {}
  const extensions = new Set(
    Array.isArray(current.extensions)
      ? current.extensions.filter((entry): entry is string => typeof entry === 'string')
      : [],
  )
  extensions.add(adapterExtension)

  const worker = {
    ...current,
    id: DISCORD_WORKER_ID,
    title: typeof current.title === 'string' ? current.title : DISCORD_WORKER_TITLE,
    emoji: typeof current.emoji === 'string' ? current.emoji : '💬',
    cwd: typeof current.cwd === 'string' ? current.cwd : DISCORD_WORKER_CWD,
    enabled: true,
    autostart: current.autostart !== false,
    discordEnabled: true,
    reportMode: typeof current.reportMode === 'string' ? current.reportMode : 'explicit',
    extensions: [...extensions],
    startupPrompt:
      typeof current.startupPrompt === 'string'
        ? current.startupPrompt
        : 'You are the Discord-facing Clawa worker. Orient in your home, follow AGENTS.md, and handle Discord turns safely.',
  }

  if (existingIndex >= 0) workers[existingIndex] = worker
  else workers.push(worker)

  config.workers = workers
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await copyDiscordWorkerTemplates(resolve(projectRoot, worker.cwd))
}

function hasGatewayToken(configPath: string): boolean {
  return Boolean(readEnvFile(configPath).DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN)
}

function startGateway(projectRoot: string, ctx: ExtensionContext): void {
  const configPath = ensureDiscordConfig(projectRoot)
  gatewayConfigPath = configPath

  if (!hasGatewayToken(configPath)) {
    if (ctx.hasUI)
      ctx.ui.notify(
        `Discord gateway config created at ${configPath}; add DISCORD_BOT_TOKEN to start it.`,
        'warning',
      )
    return
  }

  if (gatewayProcess && !gatewayProcess.killed) return

  const clawa = resolveClawaDefaults(projectRoot)
  gatewayProcess = spawn(process.execPath, ['--import', 'tsx', GATEWAY_ENTRY, 'start'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PIDG_CONFIG: DISCORD_CONFIG_RELATIVE,
      PI_CWD: '.',
      PI_CLAW_PROJECT_ROOT: projectRoot,
      PI_CLAWAS_CONTROL_SOCKET_ROOT: '.pi',
      PI_CLAWAS_CONTROL_SOCKET_DIR: clawa.controlSocketDir,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  gatewayProcess.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim()
    if (text && ctx.hasUI) ctx.ui.notify(`Discord gateway: ${text.slice(0, 240)}`, 'warning')
  })

  gatewayProcess.once('exit', (code, signal) => {
    gatewayProcess = null
    if (ctx.hasUI && code !== 0 && signal !== 'SIGTERM') {
      ctx.ui.notify(`Discord gateway stopped (${signal ?? code ?? 'unknown'})`, 'warning')
    }
  })

  if (ctx.hasUI) ctx.ui.notify('Discord gateway started for this Clawa workspace.', 'info')
}

function stopGateway(): void {
  gatewayProcess?.kill('SIGTERM')
  gatewayProcess = null
}

function restartGateway(projectRoot: string, ctx: ExtensionContext): void {
  stopGateway()
  startGateway(projectRoot, ctx)
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
  if (mode === 'token') {
    return [
      '╭─ Clawa Discord setup',
      '│ paste bot token, then Enter',
      `│ ${input ? '•'.repeat(Math.min(input.length, 48)) : 'token: '}`,
      '╰─ Enter save · Esc cancel',
    ]
  }

  if (mode === 'channel') {
    return [
      '╭─ Clawa Discord setup',
      '│ paste Discord channel id, then Enter',
      `│ ${input || 'channel id: '}`,
      '╰─ Enter save · Esc cancel',
    ]
  }

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

async function runDiscordGui(
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

      if (mode === 'token') {
        writeEnvValue(snapshot.configPath, 'DISCORD_BOT_TOKEN', value)
        message = 'token saved'
      } else if (mode === 'channel') {
        const channelId = sanitizeChannelId(value)
        writeEnvValue(
          snapshot.configPath,
          'CLAWAS_CHANNEL_WORKERS',
          `${channelId}=${DISCORD_WORKER_ID}`,
        )
        message = 'channel mapped to discord-clawa'
      }

      mode = 'menu'
      refresh()
    }

    const activate = () => {
      const item = items[selected]
      if (!item) return
      if (item.action === 'guide') {
        pi.sendUserMessage(buildDiscordSetupGuidePrompt())
        ctx.ui.notify('Sent Discord setup guide prompt.', 'info')
        done()
        return
      }
      if (item.action === 'close') {
        done()
        return
      }
      if (item.action === 'token' || item.action === 'channel') {
        mode = item.action
        input = ''
        message = ''
        tui.requestRender()
        return
      }
      if (item.action === 'restart') {
        restartGateway(projectRoot, ctx)
        message = snapshot.tokenSet ? 'gateway started' : 'token needed before gateway can start'
        refresh()
        return
      }
      if (item.action === 'stop') {
        stopGateway()
        message = 'gateway stopped'
        refresh()
      }
    }

    return {
      render: () => renderDiscordGui({ snapshot, items, selected, mode, input, message }),
      invalidate: refresh,
      handleInput(data: string) {
        if (data === '\u001b') {
          if (mode === 'menu') done()
          else {
            mode = 'menu'
            input = ''
            tui.requestRender()
          }
          return
        }

        if (mode !== 'menu') {
          const newlineIndex = data.search(INPUT_NEWLINE_REGEX)
          if (newlineIndex >= 0) {
            input += data.slice(0, newlineIndex)
            saveInput()
            return
          }
          if (data === '\r' || data === '\n') {
            saveInput()
            return
          }
          if (data === '\u007f' || data === '\b') {
            input = input.slice(0, -1)
            tui.requestRender()
            return
          }
          input += data.replace(/[\r\n]/g, '')
          tui.requestRender()
          return
        }

        if (data === '\r' || data === '\n') {
          activate()
          return
        }
        if (data === '\u001b[A' || data === 'k') {
          selected = Math.max(0, selected - 1)
          tui.requestRender()
          return
        }
        if (data === '\u001b[B' || data === 'j') {
          selected = Math.min(items.length - 1, selected + 1)
          tui.requestRender()
        }
      },
    }
  })
}

function resolveWorkerChannelJid(workerId: string): string | null {
  if (!gatewayConfigPath) return null
  const map = readEnvFile(gatewayConfigPath).CLAWAS_CHANNEL_WORKERS ?? ''
  for (const entry of map
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)) {
    const equals = entry.indexOf('=')
    if (equals === -1) continue
    const channel = entry.slice(0, equals).trim()
    const worker = entry.slice(equals + 1).trim()
    if (worker === workerId) return channel.startsWith('dc:') ? channel : `dc:${channel}`
  }
  return null
}

function registerDiscordTool(pi: ExtensionAPI): void {
  if (process.env.PI_CLAWAS_DISCORD_ENABLED !== '1') return

  const projectRoot = process.env.PI_CLAW_PROJECT_ROOT ?? findRepoRoot(process.cwd())
  const configuredGatewayPath = process.env.PIDG_CONFIG?.trim()
  gatewayConfigPath = configuredGatewayPath
    ? isAbsolute(configuredGatewayPath)
      ? configuredGatewayPath
      : resolve(projectRoot, configuredGatewayPath)
    : resolve(projectRoot, DISCORD_CONFIG_RELATIVE)
  process.env.PIDG_CONFIG ??= DISCORD_CONFIG_RELATIVE
  process.env.PI_CLAW_PROJECT_ROOT ??= projectRoot
  process.env.PI_CWD ??= projectRoot

  pi.registerTool({
    name: 'message_discord',
    label: 'Message Discord',
    description:
      'Public Discord send lane. Use for explicit public sends, native replies, reactions, attachments, multi-send delivery, or public sends from private/control turns.',
    parameters: Type.Object({
      message: Type.String({ description: 'Public Discord message to send.' }),
      replyToMessageId: Type.Optional(
        Type.String({ description: 'Optional Discord message id to reply to.' }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const workerId = process.env.PI_CLAWAS_WORKER_ID?.trim()
      const workerTitle = process.env.PI_CLAWAS_WORKER_TITLE?.trim() || workerId || 'worker'
      const message = normalizeDiscordReplyText(params.message)
      if (!workerId) throw new Error('PI_CLAWAS_WORKER_ID is missing')
      if (!message) return { content: [{ type: 'text', text: 'No public Discord beat sent.' }] }

      const channelJid = resolveWorkerChannelJid(workerId)
      if (!channelJid)
        throw new Error(`No Discord channel mapping found for Clawas worker ${workerId}`)

      const replyToMessageId =
        typeof params.replyToMessageId === 'string' && params.replyToMessageId.trim()
          ? params.replyToMessageId.trim()
          : getLastDiscordSourceMessageId(ctx)
      const { sendFilesToDiscord } = await import('./src/gateway/discord/send.js')
      await sendFilesToDiscord({ channelJid, text: message, replyToMessageId, files: [] })
      publishClawasDeliveryMessage(pi, message, { route: 'discord', workerId, workerTitle })
      return {
        content: [{ type: 'text', text: 'Sent public Discord beat.' }],
        details: { workerId },
      }
    },
  })
}

export default function clawDiscord(pi: ExtensionAPI): void {
  registerDiscordTool(pi)

  if (process.env.PI_CLAWAS_ROLE === 'worker') return

  pi.registerCommand('discord', {
    description: 'Open Clawa Discord setup',
    handler: async (_args, ctx) => {
      const projectRoot = findRepoRoot(ctx.cwd)
      ensureDiscordConfig(projectRoot)
      await ensureDiscordWorker(projectRoot)
      await runDiscordGui(pi, ctx, projectRoot)
    },
  })

  pi.on('session_start', async (_event, ctx) => {
    const projectRoot = findRepoRoot(ctx.cwd)
    ensureDiscordConfig(projectRoot)
    await ensureDiscordWorker(projectRoot)
    startGateway(projectRoot, ctx)
  })

  pi.on('session_shutdown', async () => {
    stopGateway()
  })
}
