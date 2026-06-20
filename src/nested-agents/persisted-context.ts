import { basename, normalize } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { resolvePath } from './paths.js'
import {
  DETAILS_KEY,
  type PersistedAgentsDetails,
  type PersistedAgentsFile,
  type TextContent,
} from './types.js'

function parsePersistedContextDetails(details: unknown): PersistedAgentsDetails | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>)[DETAILS_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const files = (value as Record<string, unknown>)['files']
  if (!Array.isArray(files)) return null
  const parsed = files.filter(isPersistedAgentsFile)
  if (parsed.length === 0) return null
  return { files: parsed.map((item) => ({ path: item.path, content: item.content })) }
}

function isPersistedAgentsFile(item: unknown): item is PersistedAgentsFile {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const pathValue = (item as Record<string, unknown>)['path']
  const contentValue = (item as Record<string, unknown>)['content']
  return typeof pathValue === 'string' && typeof contentValue === 'string'
}

export function mergePersistedContextDetails(
  baseDetails: unknown,
  injected: PersistedAgentsDetails,
): Record<string, unknown> {
  if (baseDetails && typeof baseDetails === 'object' && !Array.isArray(baseDetails)) {
    return { ...(baseDetails as Record<string, unknown>), [DETAILS_KEY]: injected }
  }
  return { [DETAILS_KEY]: injected }
}

export function collectBranchContext(
  ctx: ExtensionContext,
  currentCwd: string,
  ignoredAgents: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>()
  const branchEntries = ctx.sessionManager.getBranch()
  for (const entry of branchEntries) {
    if (!isMessageEntry(entry)) continue
    const persisted = parsePersistedContextDetails(entry.message.details)
    if (!persisted) continue
    for (const file of persisted.files) {
      const absolute = normalize(resolvePath(file.path, currentCwd))
      if (basename(absolute) !== 'AGENTS.md' || ignoredAgents.has(absolute)) continue
      out.set(absolute, file.content)
    }
  }
  return out
}

function isMessageEntry(
  entry: unknown,
): entry is { type: 'message'; message: { details?: unknown } } {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  const record = entry as Record<string, unknown>
  if (record['type'] !== 'message') return false
  const message = record['message']
  return Boolean(message && typeof message === 'object' && !Array.isArray(message))
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function appendAgentsContext<TContent extends { type: string }>(
  content: TContent[],
  files: PersistedAgentsFile[],
): Array<TContent | TextContent> {
  if (files.length === 0) return content
  const appendix = [
    '<clawa_nested_agents_context>',
    'Nested AGENTS.md context relevant to this tool result.',
    ...files.map((file) => {
      return `<agents_file path="${escapeXml(file.path)}">\n${escapeXml(file.content)}\n</agents_file>`
    }),
    '</clawa_nested_agents_context>',
  ].join('\n')
  return [...content, { type: 'text', text: appendix }]
}
