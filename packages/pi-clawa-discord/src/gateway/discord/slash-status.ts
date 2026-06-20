import type {
  ChannelSessionStatus,
  SessionContextUsage,
  SessionTokenUsage,
} from '../agent/invoke.js'
import type { EffectiveChannelSettings } from '../agent/channel-settings.js'

export function buildStatusMessage(
  effective: EffectiveChannelSettings,
  sessionStatus: ChannelSessionStatus,
): string {
  const rows: Array<[string, string]> = [
    ['Model', formatModelValue(effective)],
    ['Thinking', formatThinkingValue(effective)],
    ['Working dir', formatWorkingDirValue(effective)],
  ]

  if (effective.thinkingAdjusted) {
    rows.push(['Fallback', formatThinkingFallback(effective)])
  }

  rows.push(
    ['Reasoning', effective.modelInfo ? (effective.modelInfo.reasoning ? 'yes' : 'no') : 'unknown'],
    ['Session', sessionStatus.createdAt ? formatSessionCreatedAt(sessionStatus.createdAt) : 'not started'],
    ['Tokens', formatTokenUsage(sessionStatus.tokens, sessionStatus.statsSource)],
    ['Context', formatContextUsage(sessionStatus.contextUsage)],
  )

  return `\`\`\`text\n${formatTwoColumnRows(rows)}\n\`\`\``
}

function formatModelValue(effective: EffectiveChannelSettings): string {
  if (effective.modelSource === 'pi runtime default') {
    return 'pi runtime default'
  }

  return `${effective.displayModel} (${formatSettingSource(effective.modelSource)})`
}

function formatThinkingValue(effective: EffectiveChannelSettings): string {
  if (!effective.hasManagedThinking || effective.thinkingSource === 'pi runtime default') {
    return 'pi runtime default'
  }

  return `${effective.effectiveThinking} (${formatSettingSource(effective.thinkingSource)})`
}

function formatThinkingFallback(effective: EffectiveChannelSettings): string {
  if (effective.modelInfo && !effective.modelInfo.reasoning && effective.requestedThinking !== 'off') {
    return `${effective.requestedThinking} -> off (no reasoning)`
  }

  if (effective.requestedThinking === 'xhigh' && effective.effectiveThinking === 'high') {
    return 'xhigh -> high (unsupported)'
  }

  return `${effective.requestedThinking} -> ${effective.effectiveThinking}`
}

function formatWorkingDirValue(effective: EffectiveChannelSettings): string {
  return `${effective.effectiveCwd} (${effective.cwdSource === 'override' ? 'channel' : 'gateway'})`
}

function formatSettingSource(source: EffectiveChannelSettings['modelSource']): string {
  switch (source) {
    case 'override':
      return 'channel'
    case 'default':
      return 'gateway'
    case 'pi runtime default':
      return 'pi'
  }
}

function formatSessionCreatedAt(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }

  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function formatTokenUsage(
  tokens: SessionTokenUsage | undefined,
  statsSource: ChannelSessionStatus['statsSource'],
): string {
  if (!tokens) {
    return statsSource === 'none' ? '0 total' : '?'
  }

  const cache = tokens.cacheRead + tokens.cacheWrite
  const details = [`${formatNumber(tokens.input)} in`, `${formatNumber(tokens.output)} out`]
  if (cache > 0) {
    details.push(`${formatNumber(cache)} cache`)
  }

  const showDetails = tokens.input > 0 || tokens.output > 0 || cache > 0
  return `${formatNumber(tokens.total)} total${showDetails ? ` (${details.join(' / ')})` : ''}`
}

function formatContextUsage(contextUsage: SessionContextUsage | undefined): string {
  if (!contextUsage) {
    return '?'
  }

  const tokens = contextUsage.tokens == null ? '?' : formatNumber(contextUsage.tokens)
  const window = contextUsage.contextWindow == null ? '?' : formatNumber(contextUsage.contextWindow)
  const percent = contextUsage.percent == null ? '?' : `${formatPercent(contextUsage.percent)}%`
  return `${tokens} / ${window} (${percent})`
}

function formatTwoColumnRows(rows: Array<[string, string]>): string {
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0)
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n')
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}
