import type {
  ChannelSessionStatus,
  SessionContextUsage,
  SessionTokenUsage,
} from '../agent/session-status.js'
import type { ClawaMappedStatus } from '../agent/clawa-status.js'

export function buildClawaStatusMessage(status: ClawaMappedStatus): string {
  const rows: Array<[string, string]> = [
    ['Route', status.workerId],
    ['Worker', `${status.title} (${status.runtime})`],
    ['Model', status.model],
    ['Thinking', status.thinking],
    ['Working dir', status.cwd],
    [
      'Session',
      status.sessionStatus.createdAt
        ? formatSessionCreatedAt(status.sessionStatus.createdAt)
        : 'not started',
    ],
    ['Tokens', formatTokenUsage(status.sessionStatus.tokens, status.sessionStatus.statsSource)],
    ['Context', formatContextUsage(status.sessionStatus.contextUsage)],
  ]

  return `\`\`\`text\n${formatTwoColumnRows(rows)}\n\`\`\``
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
