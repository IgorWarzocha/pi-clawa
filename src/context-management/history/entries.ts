import { readFile, stat } from 'node:fs/promises'
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
  if (chat.sessionId === ctx.sessionManager.getSessionId()) return ctx.sessionManager.getBranch()
  if ((await stat(chat.sessionFile)).size > 32 * 1024 * 1024)
    throw new Error(`Session too large to read: ${chat.sessionId}`)
  const content = await readFile(chat.sessionFile, 'utf8')
  const entries = parseSessionEntries(content)
  const header = entries[0]
  if (header?.type !== 'session' || header.id !== chat.sessionId || header.cwd !== chat.cwd) {
    throw new Error(`Session file no longer matches catalog chat ${chat.sessionId}`)
  }
  const byId = new Map<string, SessionEntry>()
  for (const entry of entries) if (entry.type !== 'session') byId.set(entry.id, entry)
  const branch: SessionEntry[] = []
  let cursor = [...byId.values()].at(-1)
  const visited = new Set<string>()
  while (cursor) {
    if (visited.has(cursor.id)) throw new Error(`Session parent cycle in chat ${chat.sessionId}`)
    visited.add(cursor.id)
    branch.push(cursor)
    if (cursor.parentId && !byId.has(cursor.parentId))
      throw new Error(`Session parent missing in chat ${chat.sessionId}`)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return branch.reverse()
}

export function extractHistory(
  chat: ChatRecord,
  entries: readonly SessionEntry[],
): { windows: HistoryWindow[]; items: HistoryItem[] } {
  const windows: HistoryWindow[] = []
  const items: HistoryItem[] = []
  let agentName = chat.agentName
  let windowId = `${chat.sessionId}:root`
  let startedAt = entries[0]?.timestamp ?? ''
  let count = 0
  const finish = () => {
    if (count || windows.length === 0)
      windows.push({
        chat_id: chat.sessionId,
        window_id: windowId,
        agent_name: agentName,
        started_at: startedAt,
        item_count: count,
      })
  }
  for (const [index, entry] of entries.entries()) {
    const next = entries[index + 1]
    const marker = windowMarker(entry, next, chat)
    if (marker) {
      if (count) finish()
      windowId = marker.windowId
      agentName = marker.agentName ?? agentName
      startedAt = entry.timestamp
      count = 0
    }
    if (entry.type === 'custom' && entry.customType === 'clawa-context-window') continue
    const item = itemOf(entry, chat, windowId, agentName)
    if (item) {
      items.push(item)
      count++
    }
  }
  finish()
  return { windows, items }
}

function windowMarker(
  entry: SessionEntry,
  next: SessionEntry | undefined,
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
  if (
    entry.type === 'compaction' &&
    !(next?.type === 'custom' && next.customType === 'clawa-context-window')
  )
    return { windowId: `${chat.sessionId}:${entry.id}` }
  return undefined
}
