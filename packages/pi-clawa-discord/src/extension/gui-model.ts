import { DISCORD_DATA_RELATIVE, GATEWAY_SOURCE_DIR, SETUP_DOC_PATH } from './constants.js'
import { ensureDiscordConfig, maskSecret, readEnvFile, writeEnvValue } from './env-file.js'
import { isGatewayRunning } from './gateway-state.js'
import type { DiscordGuiItem, DiscordGuiMode, DiscordGuiSnapshot } from './gui-types.js'

export function buildDiscordSnapshot(projectRoot: string): DiscordGuiSnapshot {
  const configPath = ensureDiscordConfig(projectRoot)
  const config = readEnvFile(configPath)
  const token = config['DISCORD_BOT_TOKEN'] || process.env['DISCORD_BOT_TOKEN']
  return {
    projectRoot,
    configPath,
    tokenSet: Boolean(token?.trim()),
    maskedToken: maskSecret(token),
    routesPath: config['ROUTES_PATH']?.trim() || `${DISCORD_DATA_RELATIVE}/routes.jsonc`,
    gatewayRunning: isGatewayRunning(),
  }
}

export function buildDiscordGuiItems(snapshot: DiscordGuiSnapshot): DiscordGuiItem[] {
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

export function buildDiscordSetupGuidePrompt(): string {
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

export function saveDiscordInput(options: {
  mode: DiscordGuiMode
  value: string
  configPath: string
}): void {
  const { mode, value, configPath } = options
  if (mode === 'token') {
    writeEnvValue(configPath, 'DISCORD_BOT_TOKEN', value)
    return
  }
}
