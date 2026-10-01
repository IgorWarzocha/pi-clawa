import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { DiscordInboundTurn } from '../bridge/contracts.js'
import type { DiscordConfig } from '../config.js'
import { sanitizeDiscordLabel } from './sanitize.js'

const ATTACHMENT_DATE = /^(\d{4})-(\d{2})-(\d{2})-/u

type CachedAttachment = DiscordInboundTurn['attachments'][number]

export interface DiscordAttachmentCandidate {
  url: string
  name: string
  contentType: string
  size: number
}

interface AttachmentRejection {
  name: string
  reason: string
}

export interface AttachmentCacheResult {
  cached: CachedAttachment[]
  rejected: AttachmentRejection[]
}

function selectAttachmentsWithinLimits(
  attachments: DiscordAttachmentCandidate[],
  limits: { maxFileBytes: number; maxTotalBytes: number },
): { accepted: DiscordAttachmentCandidate[]; rejected: AttachmentRejection[] } {
  const accepted: DiscordAttachmentCandidate[] = []
  const rejected: AttachmentRejection[] = []
  let total = 0
  for (const attachment of attachments) {
    if (limits.maxFileBytes > 0 && attachment.size > limits.maxFileBytes) {
      rejected.push({ name: attachment.name, reason: 'file is too large' })
      continue
    }
    if (limits.maxTotalBytes > 0 && total + attachment.size > limits.maxTotalBytes) {
      rejected.push({ name: attachment.name, reason: 'message attachments are too large' })
      continue
    }
    total += attachment.size
    accepted.push(attachment)
  }
  return { accepted, rejected }
}

export async function cacheDiscordAttachments(
  config: DiscordConfig,
  messageId: string,
  createdAt: Date,
  candidates: DiscordAttachmentCandidate[],
  signal?: AbortSignal,
): Promise<AttachmentCacheResult> {
  const selection = selectAttachmentsWithinLimits(candidates, {
    maxFileBytes: config.maxAttachmentBytes,
    maxTotalBytes: config.maxTotalAttachmentBytes,
  })
  const cached: CachedAttachment[] = []
  const rejected = [...selection.rejected]
  let actualTotal = 0

  for (const attachment of selection.accepted) {
    const index = candidates.indexOf(attachment)
    try {
      const remaining =
        config.maxTotalAttachmentBytes > 0
          ? config.maxTotalAttachmentBytes - actualTotal
          : Number.POSITIVE_INFINITY
      const byteLimit = minimumPositive(config.maxAttachmentBytes, remaining)
      const existing = findCachedDiscordAttachmentPath(
        config.assetsDir,
        messageId,
        createdAt,
        index,
        attachment,
      )
      if (existing) {
        const size = statSync(existing).size
        if (size > byteLimit) throw new Error('cached attachment exceeds byte limit')
        actualTotal += size
        cached.push({ ...attachment, size, localPath: existing })
        continue
      }
      const bytes = await downloadAttachment(attachment.url, byteLimit, signal)
      actualTotal += bytes.byteLength
      const localPath = attachmentPath(config.assetsDir, messageId, createdAt, index, attachment)
      mkdirSync(join(localPath, '..'), { recursive: true })
      writeFileSync(localPath, bytes, { mode: 0o600 })
      cached.push({
        name: sanitizeDiscordLabel(attachment.name) || `attachment-${index + 1}`,
        contentType: sanitizeDiscordLabel(attachment.contentType),
        size: bytes.byteLength,
        localPath,
      })
    } catch (error) {
      rejected.push({
        name: attachment.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { cached, rejected }
}

export function findCachedDiscordAttachmentPath(
  assetsDir: string,
  messageId: string,
  createdAt: Date,
  index: number,
  attachment: DiscordAttachmentCandidate,
): string | undefined {
  const path = attachmentPath(assetsDir, messageId, createdAt, index, attachment)
  return existsSync(path) ? path : undefined
}

export function cleanupOldAttachments(config: DiscordConfig, now = new Date()): void {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const cutoff = today - (config.attachmentRetentionDays - 1) * 24 * 60 * 60 * 1_000
  for (const year of readDirectories(config.assetsDir)) {
    const yearPath = join(config.assetsDir, year)
    for (const month of readDirectories(yearPath)) {
      pruneAttachmentMonth(join(yearPath, month), cutoff)
    }
    removeEmptyDirectory(yearPath)
  }
}

function pruneAttachmentMonth(monthPath: string, cutoff: number): void {
  for (const kind of ['images', 'videos', 'files']) {
    const kindPath = join(monthPath, kind)
    for (const file of readFiles(kindPath)) {
      const timestamp = parseAttachmentDate(file)
      if (timestamp !== null && timestamp < cutoff) rmSync(join(kindPath, file), { force: true })
    }
    removeEmptyDirectory(kindPath)
  }
  removeEmptyDirectory(monthPath)
}

async function downloadAttachment(
  url: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('attachment URL is not HTTPS')
  const deadline = AbortSignal.timeout(30_000)
  const response = await fetch(parsed, {
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  })
  if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`)
  if (!response.body) throw new Error('download returned no body')

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('download exceeded the attachment limit')
    }
    chunks.push(part.value)
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function attachmentPath(
  assetsDir: string,
  messageId: string,
  date: Date,
  index: number,
  attachment: DiscordAttachmentCandidate,
): string {
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const extension = safeExtension(attachment)
  // Signed CDN query parameters rotate; the pathname identifies the actual attachment.
  const source = new URL(attachment.url)
  const messageKey = createHash('sha256')
    .update(`${messageId}:${source.origin}${source.pathname}`)
    .digest('hex')
    .slice(0, 12)
  return join(
    assetsDir,
    year,
    month,
    attachmentKind(attachment.contentType),
    `${year}-${month}-${day}-${messageKey}-a${index + 1}${extension}`,
  )
}

function attachmentKind(contentType: string): 'files' | 'images' | 'videos' {
  const normalized = contentType.toLowerCase()
  if (normalized.startsWith('image/')) return 'images'
  if (normalized.startsWith('video/')) return 'videos'
  return 'files'
}

function safeExtension(attachment: DiscordAttachmentCandidate): string {
  const known: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
  }
  const contentType = attachment.contentType.toLowerCase()
  if (known[contentType]) return known[contentType]
  return extname(attachment.name)
    .toLowerCase()
    .replace(/[^a-z0-9.]/gu, '')
    .slice(0, 16)
}

function minimumPositive(first: number, second: number): number {
  if (first <= 0) return second
  return Math.min(first, second)
}

function parseAttachmentDate(file: string): number | null {
  const match = file.match(ATTACHMENT_DATE)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const value = Date.UTC(year, month - 1, day)
  return Number.isFinite(value) ? value : null
}

function readDirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function readFiles(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function removeEmptyDirectory(path: string): void {
  if (existsSync(path) && readdirSync(path).length === 0) rmSync(path, { recursive: true })
}
