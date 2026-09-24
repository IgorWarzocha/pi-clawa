import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeDiscordText } from './sanitize.js'

export interface DiscordLinkMeta {
  url: string
  title?: string | undefined
  description?: string | undefined
}

interface DiscordEmbedLike {
  url?: string | null | undefined
  title?: string | null | undefined
  description?: string | null | undefined
}

const URL_TRAILING_PUNCTUATION = /[),.;!?]+$/u

const LINKS_INDEX_HEADER = `# Discord links

Room context, not automatic memory. Promote durable understanding into the vault; most links are passing scenery and should not be preserved twice.

`

export function buildDiscordLinkMetas(
  content: string,
  embeds: readonly DiscordEmbedLike[] = [],
): DiscordLinkMeta[] {
  return extractDiscordLinks(content).map((url) => {
    const embed = embeds.find((item) => item.url && sameUrl(item.url, url))
    return {
      url,
      title: cleanEmbedText(embed?.title, 200),
      description: cleanEmbedText(embed?.description, 500),
    }
  })
}

export function appendDiscordLinksIndex(options: {
  assetsDir: string
  messageId: string
  messageUrl: string
  createdAt: Date
  senderName: string
  channelLabel: string
  links: readonly DiscordLinkMeta[]
}): string | undefined {
  if (options.links.length === 0) return
  const year = String(options.createdAt.getUTCFullYear())
  const month = String(options.createdAt.getUTCMonth() + 1).padStart(2, '0')
  const directory = join(options.assetsDir, year, month)
  const indexPath = join(directory, 'links.md')
  const marker = `<!-- clawa-discord-message:${options.messageId} -->`
  mkdirSync(directory, { recursive: true })

  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  if (existing.includes(marker)) return indexPath
  if (!existing.startsWith('# Discord links')) {
    writeFileSync(indexPath, `${LINKS_INDEX_HEADER}${existing}`, 'utf8')
  }

  const source = options.messageUrl ? ` — [source](${options.messageUrl})` : ''
  const timestamp = options.createdAt.toISOString()
  const lines = options.links.map(
    (link) =>
      `- ${timestamp} — ${options.senderName} — ${options.channelLabel} — ${markdownLink(link)}${source}`,
  )
  appendFileSync(indexPath, `${marker}\n${lines.join('\n')}\n`, 'utf8')
  return indexPath
}

function extractDiscordLinks(content: string): string[] {
  const links: string[] = []
  const seen = new Set<string>()
  for (const match of content.matchAll(/https?:\/\/[^\s<>()]+/giu)) {
    const raw = (match[0] ?? '').replace(URL_TRAILING_PUNCTUATION, '')
    if (!raw || seen.has(raw)) continue
    seen.add(raw)
    links.push(raw)
  }
  return links
}

function sameUrl(leftValue: string, rightValue: string): boolean {
  try {
    const left = new URL(leftValue)
    const right = new URL(rightValue)
    left.hash = ''
    right.hash = ''
    return left.toString() === right.toString()
  } catch {
    return leftValue === rightValue
  }
}

function cleanEmbedText(value: string | null | undefined, limit: number): string | undefined {
  const text = sanitizeDiscordText(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!text) return
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}

function markdownLink(link: DiscordLinkMeta): string {
  const title = link.title?.replace(/[[\]]/gu, '')
  const label = title || link.url
  return link.description
    ? `[${label}](${link.url}) — ${link.description}`
    : `[${label}](${link.url})`
}
