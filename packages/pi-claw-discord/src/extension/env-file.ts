import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveClawaDefaults, resolveClawasControlSocketRoot } from '@howaboua/pi-claw/config'
import {
  DISCORD_CONFIG_RELATIVE,
  DISCORD_DATA_RELATIVE,
  LINE_SPLIT_REGEX,
  TOKEN_VISIBLE_PREFIX,
  TOKEN_VISIBLE_SUFFIX,
  TRAILING_NEWLINES_REGEX,
} from './constants.js'
import { setGatewayConfigPath } from './gateway-state.js'

export function maskSecret(value: string | undefined): string {
  const token = value?.trim() ?? ''
  if (!token) return 'missing'
  if (token.length <= TOKEN_VISIBLE_PREFIX + TOKEN_VISIBLE_SUFFIX) return 'set'
  return `${token.slice(0, TOKEN_VISIBLE_PREFIX)}…${token.slice(-TOKEN_VISIBLE_SUFFIX)}`
}

export function readEnvFile(filePath: string): Record<string, string> {
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

export function writeEnvValue(filePath: string, key: string, value: string): void {
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
    `PI_CLAWAS_CONTROL_SOCKET_ROOT=${resolveClawasControlSocketRoot(projectRoot)}`,
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

export function ensureDiscordConfig(projectRoot: string): string {
  const configPath = resolve(projectRoot, DISCORD_CONFIG_RELATIVE)
  if (!existsSync(configPath)) writeDefaultDiscordConfig(projectRoot, configPath)
  setGatewayConfigPath(configPath)
  return configPath
}
