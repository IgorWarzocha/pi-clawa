import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { type DiscordConfig, writeConfigValue } from '../config.js'

export interface DiscordSetupTarget {
  config: DiscordConfig
  chatEnabled: boolean
  describeStatus(): string
  guide(): void
  setChatEnabled(enabled: boolean): void
  restart(): Promise<void>
  stop(): Promise<void>
}

interface SetupItem {
  label: string
  run(): Promise<void> | void
}

export async function runDiscordSetup(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): Promise<void> {
  if (!context.hasUI) {
    context.ui.notify(`Discord config: ${target.config.configPath}`, 'info')
    return
  }
  const items = buildSetupItems(context, target)
  const action = await context.ui.select(
    'This Clawa on Discord',
    items.map((item) => item.label),
  )
  if (!action) return
  await items.find((item) => item.label === action)?.run()
}

function buildSetupItems(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): SetupItem[] {
  return [
    { label: 'Guide me through creating the Discord bot', run: target.guide },
    {
      label: `Status · ${singleLine(target.describeStatus())}`,
      run: () => context.ui.notify(target.describeStatus(), 'info'),
    },
    {
      label: `Chat intake · ${target.chatEnabled ? 'armed' : 'monitor only'}`,
      run: () => target.setChatEnabled(!target.chatEnabled),
    },
    {
      label: `Set bot token · ${target.config.token ? 'configured' : 'missing'}`,
      run: async () => await editToken(context, target),
    },
    {
      label: `Ambient wake · ${target.config.ambientWakeEnabled ? 'on' : 'off'}`,
      run: async () => {
        writeConfigValue(
          target.config.configPath,
          'AMBIENT_WAKE_ENABLED',
          String(!target.config.ambientWakeEnabled),
        )
        await target.restart()
      },
    },
    {
      label: `Trigger aliases · ${target.config.triggerAliases.join(', ') || 'none'}`,
      run: async () => await editTriggerAliases(context, target),
    },
    {
      label: `Channels · ${target.config.channelPolicy}`,
      run: async () => await editChannelPolicy(context, target),
    },
    {
      label: `Allowed users · ${target.config.allowedUserIds.size > 0 ? target.config.allowedUserIds.size : 'all'}`,
      run: async () =>
        await editIdList(context, target, 'ALLOWED_USER_IDS', 'Allowed Discord user ids'),
    },
    {
      label: `Default DM · ${target.config.defaultDmUserId ? 'configured' : 'not set'}`,
      run: async () => await editDefaultDm(context, target),
    },
    {
      label: `Allowed channels · ${target.config.allowedChannelIds.size}`,
      run: async () =>
        await editIdList(context, target, 'ALLOWED_CHANNEL_IDS', 'Allowed Discord channel ids'),
    },
    {
      label: `Excluded channels · ${target.config.excludedChannelIds.size}`,
      run: async () =>
        await editIdList(context, target, 'EXCLUDED_CHANNEL_IDS', 'Excluded Discord channel ids'),
    },
    { label: 'Start or restart Discord', run: target.restart },
    { label: 'Stop Discord', run: target.stop },
    {
      label: `Config · ${target.config.configPath}`,
      run: () => context.ui.notify(`Discord config: ${target.config.configPath}`, 'info'),
    },
  ]
}

async function editToken(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): Promise<void> {
  const token = await context.ui.input(
    'Discord bot token',
    'Paste token; empty disconnects this home',
  )
  if (token === undefined) return
  writeConfigValue(target.config.configPath, 'DISCORD_BOT_TOKEN', token.trim())
  await target.restart()
}

async function editChannelPolicy(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): Promise<void> {
  const policy = await context.ui.select('Which Discord messages reach Pi?', [
    'mentions',
    'channels',
    'all',
  ])
  if (!policy) return
  writeConfigValue(target.config.configPath, 'CHANNEL_POLICY', policy)
  await target.restart()
}

async function editTriggerAliases(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): Promise<void> {
  const value = await context.ui.input(
    'Trigger aliases',
    target.config.triggerAliases.join(', ') || 'comma-separated aliases, blank to clear',
  )
  if (value === undefined) return
  const aliases = value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
    .join(',')
  writeConfigValue(target.config.configPath, 'TRIGGER_ALIASES', aliases)
  await target.restart()
}

async function editIdList(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
  key: 'ALLOWED_USER_IDS' | 'ALLOWED_CHANNEL_IDS' | 'EXCLUDED_CHANNEL_IDS',
  title: string,
): Promise<void> {
  const value = await context.ui.input(title, 'comma-separated ids, blank to clear')
  if (value === undefined) return
  writeConfigValue(target.config.configPath, key, value.replace(/\s+/gu, ''))
  await target.restart()
}

async function editDefaultDm(
  context: ExtensionCommandContext,
  target: DiscordSetupTarget,
): Promise<void> {
  const value = await context.ui.input('Default Discord DM user id', target.config.defaultDmUserId)
  if (value === undefined) return
  writeConfigValue(target.config.configPath, 'DEFAULT_DM_USER_ID', value.trim())
  await target.restart()
}

function singleLine(status: string): string {
  return status.split('\n')[0] ?? status
}
