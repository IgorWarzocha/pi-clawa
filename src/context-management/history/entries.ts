import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  type ExtensionContext,
  parseSessionEntries,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type { ChatRecord } from './catalog.js'

export interface HistoryItem {
  chat_id: string
  window_id: string
  agent_name: string
  item_id: string
  role: string
  text: string
  timestamp: string
  tool_name?: string
  tool_namespace?: string
}

export interface HistoryWindow {
  chat_id: string
  window_id: string
  agent_name: string
  started_at: string
  item_count: number
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part: unknown) => {
      if (typeof part !== 'object' || part === null || !('type' in part)) return []
      if (part.type === 'text' && 'text' in part && typeof part.text === 'string')
        return [part.text]
      if (part.type === 'toolCall' && 'name' in part && typeof part.name === 'string') {
        return [JSON.stringify(part)]
      }
      return []
    })
    .join('\n')
}

function toolFields(name: string | undefined): Pick<HistoryItem, 'tool_name' | 'tool_namespace'> {
  if (!name) return {}
  const separator = name.indexOf('__')
  return separator > 0
    ? { tool_name: name.slice(separator + 2), tool_namespace: name.slice(0, separator) }
    : { tool_name: name }
}

function itemOf(
  entry: SessionEntry,
  chat: ChatRecord,
  windowId: string,
  agentName: string,
): HistoryItem | undefined {
  let role: string
  let text: string
  let name: string | undefined
  switch (entry.type) {
    case 'message': {
      const message = entry.message
      role = message.role === 'toolResult' ? 'tool' : message.role
      text = 'content' in message ? textOf(message.content) : JSON.stringify(message)
      name = message.role === 'toolResult' ? message.toolName : undefined
      if (message.role === 'assistant') {
        const call = message.content.find((part) => part.type === 'toolCall')
        name = call?.type === 'toolCall' ? call.name : undefined
      }
      break
    }
    case 'custom_message':
      role = 'system'
      text = textOf(entry.content)
      break
    case 'compaction':
    case 'branch_summary':
      role = 'system'
      text = entry.summary
      break
    default:
      return undefined
  }
  return {
    chat_id: chat.sessionId,
    window_id: windowId,
    agent_name: agentName,
    item_id: entry.id,
    role,
    text,
    timestamp: entry.timestamp,
    ...toolFields(name),
  }
}

export async function readChatEntries(
  chat: ChatRecord,
  ctx: ExtensionContext,
): Promise<SessionEntry[]> {
  if (chat.sessionId === ctx.sessionManager.getSessionId()) {
    const manager = ctx.sessionManager
    const header = manager.getHeader()
    if (header?.id !== chat.sessionId || resolve(header.cwd) !== resolve(chat.cwd))
      throw new Error(`Session file no longer matches catalog chat ${chat.sessionId}`)
    return expandNativeBranch(manager.getEntries(), manager.getLeafId())
  }
  if ((await stat(chat.sessionFile)).size > 32 * 1024 * 1024)
    throw new Error(`Session too large to read: ${chat.sessionId}`)
  const content = await readFile(chat.sessionFile, 'utf8')
  const entries = parseSessionEntries(content)
  const header = entries[0]
  if (header?.type !== 'session' || header.id !== chat.sessionId || header.cwd !== chat.cwd) {
    throw new Error(`Session file no longer matches catalog chat ${chat.sessionId}`)
  }
  const raw = entries.filter((entry): entry is SessionEntry => entry.type !== 'session')
  return expandNativeBranch(raw, raw.at(-1)?.id ?? null)
}

/** Raw history follows only parents and explicit native branch_summary source links.
 * Pi's fromId is the previous leaf, not a private details format or a whole-tree archive.
 * Emit shared ancestors once and archived paths before their summary. Never substitute
 * summary prose for missing raw source. Iterative traversal also bounds call-stack use.
 */
export function expandNativeBranch(
  entries: readonly SessionEntry[],
  leafId: string | null,
): SessionEntry[] {
  if (leafId === null) return []
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branch: SessionEntry[] = []
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  const pending = [{ id: leafId, finish: false, source: false }]
  while (pending.length > 0) {
    const step = pending.pop()
    if (!step || emitted.has(step.id)) continue
    const entry = byId.get(step.id)
    if (!entry)
      throw new Error(
        step.source
          ? `Archived raw source missing: ${step.id}`
          : `Session parent or leaf missing: ${step.id}`,
      )
    if (step.finish) {
      visiting.delete(step.id)
      emitted.add(step.id)
      branch.push(entry)
      continue
    }
    if (visiting.has(step.id)) throw new Error(`Session branch cycle: ${step.id}`)
    visiting.add(step.id)
    pending.push({ ...step, finish: true })
    pending.push(
      ...nativeBranchLinks(entry, step.source).map((link) => ({ ...link, finish: false })),
    )
  }
  return branch
}

function nativeBranchLinks(
  entry: SessionEntry,
  archived: boolean,
): { id: string; source: boolean }[] {
  const links: { id: string; source: boolean }[] = []
  // Pi uses "root" when a summary is created with no previous leaf.
  if (entry.type === 'branch_summary' && entry.fromId !== 'root')
    links.push({ id: entry.fromId, source: true })
  // The traversal stack visits parents before the archived source.
  if (entry.parentId) links.push({ id: entry.parentId, source: archived })
  return links
}

export function extractHistory(
  chat: ChatRecord,
  entries: readonly SessionEntry[],
): { windows: HistoryWindow[]; items: HistoryItem[] } {
  const windows = new Map<string, HistoryWindow>()
  const items: HistoryItem[] = []
  const root: HistoryWindow = {
    chat_id: chat.sessionId,
    window_id: `${chat.sessionId}:root`,
    agent_name: chat.agentName,
    started_at: entries[0]?.timestamp ?? '',
    item_count: 0,
  }
  const lineage = new Map<string, HistoryWindow>()
  const legacyBoundaries = new Set(
    entries.flatMap((entry) =>
      entry.type === 'custom' && entry.customType === 'clawa-context-window' && entry.parentId
        ? [entry.parentId]
        : [],
    ),
  )
  let owner = root
  for (const entry of entries) {
    // Expanded archives are topological, not one conversation chain. A sibling's
    // compaction must never relabel raw turns recovered through a summary source.
    owner = (entry.parentId ? lineage.get(entry.parentId) : undefined) ?? root
    const marker = windowMarker(entry, legacyBoundaries.has(entry.id), chat)
    if (marker) {
      owner = windows.get(marker.windowId) ?? {
        chat_id: chat.sessionId,
        window_id: marker.windowId,
        agent_name: marker.agentName ?? owner.agent_name,
        started_at: entry.timestamp,
        item_count: 0,
      }
    }
    lineage.set(entry.id, owner)
    const item = itemOf(entry, chat, owner.window_id, owner.agent_name)
    if (item) {
      items.push(item)
      const window = windows.get(owner.window_id) ?? owner
      window.item_count++
      windows.set(window.window_id, window)
    }
  }
  return { windows: windows.size > 0 ? [...windows.values()] : [owner], items }
}

function windowMarker(
  entry: SessionEntry,
  followedByLegacyMarker: boolean,
  chat: ChatRecord,
): { windowId: string; agentName?: string } | undefined {
  if (entry.type === 'custom' && entry.customType === 'clawa-context-window') {
    const data = entry.data
    if (
      typeof data !== 'object' ||
      data === null ||
      !('windowId' in data) ||
      typeof data.windowId !== 'string' ||
      !data.windowId
    )
      return undefined
    return {
      windowId: data.windowId,
      ...('agentName' in data && typeof data.agentName === 'string'
        ? { agentName: data.agentName }
        : {}),
    }
  }
  if (entry.type === 'compaction' && !followedByLegacyMarker)
    return { windowId: `${chat.sessionId}:${entry.id}` }
  return undefined
}
