import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse } from 'dotenv'

export type ChannelPolicy = 'mentions' | 'channels' | 'all'
export type DiscordStatusType = 'Playing' | 'Watching' | 'Listening' | 'Competing'

export interface DiscordConfig {
  projectRoot: string
  configPath: string
  dataDir: string
  assetsDir: string
  channelsPath: string
  token: string
  defaultDmUserId: string
  allowedUserIds: ReadonlySet<string>
  channelPolicy: ChannelPolicy
  allowedChannelIds: ReadonlySet<string>
  excludedChannelIds: ReadonlySet<string>
  triggerAliases: string[]
  discordStatusText: string
  discordStatusType: DiscordStatusType
  discordChatEnabled: boolean
  ambientWakeEnabled: boolean
  ambientWakeMinMessages: number
  ambientWakeMaxMessages: number
  discordActivityLines: number
  recentContextMessages: number
  maxQueue: number
  maxAttachmentBytes: number
  maxTotalAttachmentBytes: number
  attachmentRetentionDays: number
}

const DEFAULTS = {
  DISCORD_BOT_TOKEN: '',
  DEFAULT_DM_USER_ID: '',
  ALLOWED_USER_IDS: '',
  CHANNEL_POLICY: 'mentions',
  ALLOWED_CHANNEL_IDS: '',
  EXCLUDED_CHANNEL_IDS: '',
  TRIGGER_ALIASES: '',
  DISCORD_STATUS_TEXT: 'here with you',
  DISCORD_STATUS_TYPE: 'Listening',
  DISCORD_CHAT_ENABLED: 'true',
  AMBIENT_WAKE_ENABLED: 'false',
  AMBIENT_WAKE_MIN_MESSAGES: '8',
  AMBIENT_WAKE_MAX_MESSAGES: '16',
  DISCORD_ACTIVITY_LINES: '4',
  RECENT_CONTEXT_MESSAGES: '12',
  MAX_QUEUE: '100',
  MAX_ATTACHMENT_BYTES: '20971520',
  MAX_TOTAL_ATTACHMENT_BYTES: '52428800',
  ATTACHMENT_RETENTION_DAYS: '30',
}

type ConfigKey = keyof typeof DEFAULTS
const LINE_BREAK = /\r?\n/u
const NEWLINE = /[\r\n]/u
const TRAILING_NEWLINES = /\n*$/u
const DISCORD_ID = /^[1-9]\d*$/u
const ENV_EXPORT = /^export\s+/u

export function loadConfig(home: string): DiscordConfig {
  // A bot belongs to this home, never to a parent repo or inherited process environment.
  const projectRoot = resolve(home)
  const dataDir = resolve(projectRoot, '.pi', 'clawa-discord')
  const configPath = resolve(dataDir, 'bot.env')
  ensureConfig(configPath)
  const source = { ...DEFAULTS, ...parse(readFileSync(configPath, 'utf8')) }
  const maxQueue = readInteger(source, 'MAX_QUEUE', 1)
  const ambientWakeMinMessages = readInteger(source, 'AMBIENT_WAKE_MIN_MESSAGES', 1)
  const ambientWakeMaxMessages = readInteger(source, 'AMBIENT_WAKE_MAX_MESSAGES', 1)
  if (ambientWakeMaxMessages < ambientWakeMinMessages || ambientWakeMaxMessages > maxQueue) {
    throw new Error('Ambient wake range must be ascending and fit MAX_QUEUE.')
  }
  const discordStatusText = source.DISCORD_STATUS_TEXT.trim()
  if (!discordStatusText || discordStatusText.length > 128) {
    throw new Error('DISCORD_STATUS_TEXT must contain 1 to 128 characters.')
  }
  const defaultDmUserId = source.DEFAULT_DM_USER_ID.trim()
  if (defaultDmUserId && !DISCORD_ID.test(defaultDmUserId)) {
    throw new Error('DEFAULT_DM_USER_ID must be a Discord user ID or empty.')
  }
  return {
    projectRoot,
    configPath,
    dataDir,
    assetsDir: resolve(dataDir, 'assets'),
    channelsPath: resolve(dataDir, 'channels.json'),
    token: source.DISCORD_BOT_TOKEN.trim(),
    defaultDmUserId,
    allowedUserIds: readIds(source.ALLOWED_USER_IDS, 'ALLOWED_USER_IDS'),
    channelPolicy: readEnum(
      source.CHANNEL_POLICY,
      ['mentions', 'channels', 'all'],
      'CHANNEL_POLICY',
    ),
    allowedChannelIds: readIds(source.ALLOWED_CHANNEL_IDS, 'ALLOWED_CHANNEL_IDS'),
    excludedChannelIds: readIds(source.EXCLUDED_CHANNEL_IDS, 'EXCLUDED_CHANNEL_IDS'),
    triggerAliases: readList(source.TRIGGER_ALIASES),
    discordStatusText,
    discordStatusType: readEnum(
      source.DISCORD_STATUS_TYPE,
      ['Playing', 'Watching', 'Listening', 'Competing'],
      'DISCORD_STATUS_TYPE',
    ),
    discordChatEnabled: readBoolean(source, 'DISCORD_CHAT_ENABLED'),
    ambientWakeEnabled: readBoolean(source, 'AMBIENT_WAKE_ENABLED'),
    ambientWakeMinMessages,
    ambientWakeMaxMessages,
    discordActivityLines: readInteger(source, 'DISCORD_ACTIVITY_LINES', 1),
    recentContextMessages: readInteger(source, 'RECENT_CONTEXT_MESSAGES', 0),
    maxQueue,
    maxAttachmentBytes: readInteger(source, 'MAX_ATTACHMENT_BYTES', 0),
    maxTotalAttachmentBytes: readInteger(source, 'MAX_TOTAL_ATTACHMENT_BYTES', 0),
    attachmentRetentionDays: readInteger(source, 'ATTACHMENT_RETENTION_DAYS', 1),
  }
}

export function writeConfigValue(configPath: string, key: ConfigKey, value: string): void {
  if (NEWLINE.test(value)) throw new Error(`${key} must fit on one line.`)
  const existing = readFileSync(configPath, 'utf8').split(LINE_BREAK)
  let found = false
  const replacement = `${key}=${JSON.stringify(value)}`
  const lines = existing.map((line) => {
    const normalized = line.trimStart().replace(ENV_EXPORT, '')
    if (normalized.startsWith('#') || normalized.split('=', 1)[0]?.trim() !== key) return line
    found = true
    return replacement
  })
  if (!found) lines.push(replacement)
  writeFileSync(configPath, `${lines.join('\n').replace(TRAILING_NEWLINES, '')}\n`, { mode: 0o600 })
}

function ensureConfig(path: string): void {
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const content = [
    '# This Clawa home owns this bot. Keep its token private.',
    ...Object.entries(DEFAULTS).map(([key, value]) => `${key}=${JSON.stringify(value)}`),
    '',
  ].join('\n')
  try {
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
}

function readList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function readIds(value: string, key: ConfigKey): ReadonlySet<string> {
  const ids = readList(value)
  if (ids.some((id) => !DISCORD_ID.test(id))) throw new Error(`${key} must contain Discord IDs.`)
  return new Set(ids)
}

function readBoolean(source: typeof DEFAULTS, key: ConfigKey): boolean {
  const value = source[key].trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${key} must be true or false.`)
}

function readInteger(source: typeof DEFAULTS, key: ConfigKey, minimum: number): number {
  const raw = source[key].trim()
  const value = Number(raw)
  if (!(raw && Number.isSafeInteger(value)) || value < minimum) {
    throw new Error(`${key} must be an integer of at least ${minimum}.`)
  }
  return value
}

function readEnum<const T extends string>(value: string, choices: readonly T[], key: ConfigKey): T {
  const match = choices.find((choice) => choice === value.trim())
  if (match === undefined) throw new Error(`${key} must be one of: ${choices.join(', ')}.`)
  return match
}
