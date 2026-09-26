import { join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ListRevisionsInput, ReadRevisionInput } from '../files/contracts.js'
import { searchFiles } from '../files/files.js'
import { boundedRows as bounded } from '../files/results.js'
import { listRevisions, readRevision } from '../files/revisions.js'
import { runNotes } from '../notes.js'
import { type ContextAccess, findChat, listCatalog } from './catalog.js'
import { extractHistory, type HistoryItem, readChatEntries } from './entries.js'

interface HistoryFilter {
  chat_id?: string
  agent_name?: string | null
  window_id?: string | null
  role?: 'user' | 'assistant' | 'tool' | 'system' | 'developer' | null
  tool_name?: string | null
  tool_namespace?: string | null
}

export type HistoryInput =
  | { action: 'list_chats'; limit?: number; before_chat_id?: string }
  | ({ action: 'list_windows'; limit?: number; recent_first?: boolean } & Pick<
      HistoryFilter,
      'agent_name' | 'chat_id'
    >)
  | ({
      action: 'list_items'
      limit?: number
      recent_first?: boolean
      max_chars_per_item?: number
    } & HistoryFilter)
  | ({
      action: 'read_item'
      item_id: string
      offset_chars?: number
      limit_chars?: number
      scope?: 'notes' | 'memory'
    } & Pick<HistoryFilter, 'agent_name' | 'window_id' | 'chat_id'>)
  | ({
      action: 'search'
      query: string
      limit?: number
      recent_first?: boolean
      scope?: 'notes' | 'memory'
    } & HistoryFilter)
  | ({ action: 'list_revisions' } & ListRevisionsInput)
  | ({ action: 'read_revision' } & ReadRevisionInput)

function matches(item: HistoryItem, filter: HistoryFilter): boolean {
  return (
    (!filter.agent_name || item.agent_name === filter.agent_name) &&
    (!filter.window_id || item.window_id === filter.window_id) &&
    (!filter.role || item.role === filter.role) &&
    (!filter.tool_name || item.tool_name === filter.tool_name) &&
    (!filter.tool_namespace || item.tool_namespace === filter.tool_namespace)
  )
}

function sliceText(text: string, offset: number, limit: number) {
  const content = text.slice(offset, offset + limit)
  return {
    content,
    offset_chars: offset,
    total_chars: text.length,
    truncated: offset + content.length < text.length,
  }
}

async function conversations(access: ContextAccess, ctx: ExtensionContext, chatId?: string) {
  const chats = [await findChat(access, ctx, chatId)]
  return Promise.all(
    chats.map(async (chat) => ({
      chat,
      ...extractHistory(chat, await readChatEntries(chat, ctx)),
    })),
  )
}

export async function runHistory(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: HistoryInput,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  switch (input.action) {
    case 'list_chats':
      return listChats(access, ctx, input)
    case 'list_windows':
      return listWindows(access, ctx, input)
    case 'list_items':
      return listItems(access, ctx, input)
    case 'search':
      return searchItems(access, ctx, input, signal)
    case 'read_item':
      return readItem(access, ctx, input)
    case 'list_revisions':
      return listRevisions(access.rootHouse, input, signal)
    case 'read_revision':
      return readRevision(access.rootHouse, input, signal)
    default:
      throw new Error('Unknown history action')
  }
}

async function listChats(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: Extract<HistoryInput, { action: 'list_chats' }>,
) {
  const all = await listCatalog(access, ctx)
  all.sort((a, b) => b.sessionId.localeCompare(a.sessionId))
  if (input.before_chat_id && !all.some((row) => row.sessionId === input.before_chat_id))
    throw new Error('Unknown before_chat_id')
  const before = input.before_chat_id
  const filtered = before ? all.filter((row) => row.sessionId < before) : all
  const { rows, truncated } = bounded(filtered.slice(0, input.limit ?? 20))
  return {
    chats: rows.map((record) => ({
      chat_id: record.sessionId,
      agent_name: record.agentName,
      cwd: record.cwd,
      session_file: record.sessionFile,
    })),
    next_before_chat_id: filtered.length > rows.length ? rows.at(-1)?.sessionId : undefined,
    truncated: truncated || filtered.length > rows.length,
  }
}

async function listWindows(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: Extract<HistoryInput, { action: 'list_windows' }>,
) {
  const rows = (await conversations(access, ctx, input.chat_id))
    .flatMap((chat) => chat.windows)
    .filter((window) => !input.agent_name || input.agent_name === window.agent_name)
  rows.sort((a, b) => a.started_at.localeCompare(b.started_at))
  if (input.recent_first !== false) rows.reverse()
  const output = bounded(rows.slice(0, input.limit ?? 20))
  return { windows: output.rows, truncated: output.truncated || rows.length > output.rows.length }
}

async function filteredItems(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: HistoryFilter,
  allChats = false,
) {
  if (!allChats)
    return (await conversations(access, ctx, input.chat_id))
      .flatMap((chat) => chat.items)
      .filter((item) => matches(item, input))
  const catalog = await listCatalog(access, ctx)
  if (catalog.length > 200) throw new Error('House search exceeds 200 chats; specify chat_id')
  const items: HistoryItem[] = []
  for (const chat of catalog) {
    items.push(
      ...extractHistory(chat, await readChatEntries(chat, ctx)).items.filter((item) =>
        matches(item, input),
      ),
    )
  }
  return items
}

function orderItems(items: HistoryItem[], recentFirst: boolean | undefined) {
  items.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  if (recentFirst !== false) items.reverse()
  return items
}

async function listItems(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: Extract<HistoryInput, { action: 'list_items' }>,
) {
  const all = orderItems(await filteredItems(access, ctx, input), input.recent_first)
  const max = input.max_chars_per_item ?? 600
  const rows = bounded(
    all.slice(0, input.limit ?? 20).map((item) => ({
      ...item,
      text: item.text.slice(0, max),
      total_chars: item.text.length,
      truncated: item.text.length > max,
    })),
  )
  return { items: rows.rows, truncated: rows.truncated || all.length > rows.rows.length }
}

async function searchItems(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: Extract<HistoryInput, { action: 'search' }>,
  signal: AbortSignal,
) {
  if (input.scope === 'memory' && input.query.length > 160)
    throw new Error('Memory search query exceeds 160 characters')
  const all = await filteredItems(access, ctx, input, input.scope === 'memory' && !input.chat_id)
  const matching = orderItems(
    all.filter((item) => item.text.includes(input.query)),
    input.recent_first,
  )
  const limit = input.limit ?? 10
  const rows = bounded(
    matching.slice(0, limit).map((item) => ({
      ...item,
      text: item.text.slice(
        Math.max(0, item.text.indexOf(input.query) - 100),
        item.text.indexOf(input.query) + input.query.length + 100,
      ),
    })),
  )
  const history = {
    matches: rows.rows,
    truncated: rows.truncated || matching.length > rows.rows.length,
  }
  if (input.scope === 'memory') {
    const [memory, changes] = await Promise.all([
      searchFiles(
        join(access.rootHouse, 'memory'),
        { query: input.query, max_files: limit, max_matches_per_file: 3 },
        signal,
      ),
      listRevisions(access.rootHouse, { query: input.query, limit }, signal),
    ])
    return { conversations: history, memory, memory_changes: changes }
  }
  const notes = await runNotes(
    access,
    ctx,
    {
      action: 'search_contents',
      query: input.query,
      ...(input.chat_id === undefined ? {} : { chat_id: input.chat_id }),
      ...(input.agent_name ? { path_prefix: `${input.agent_name}/notes/` } : {}),
      max_files: limit,
      max_matches_per_file: 3,
    },
    signal,
  )
  return { history, notes: notes.value }
}

async function readItem(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: Extract<HistoryInput, { action: 'read_item' }>,
) {
  const item = (await filteredItems(access, ctx, input)).find(
    (entry) => entry.item_id === input.item_id,
  )
  if (!item) throw new Error('History item not found with these chat, window and agent filters')
  return {
    chat_id: item.chat_id,
    window_id: item.window_id,
    item_id: item.item_id,
    ...sliceText(item.text, input.offset_chars ?? 0, input.limit_chars ?? 4000),
  }
}
