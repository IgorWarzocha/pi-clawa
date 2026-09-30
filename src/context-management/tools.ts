import { StringEnum } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import {
  ChangeFileInput,
  ListFilesInput,
  ListRevisionsInput,
  ReadFileInput,
  ReadRevisionInput,
  SearchContentsInput,
} from './files/contracts.js'
import { type ContextAccess, indexCurrentChat } from './history/catalog.js'
import { type HistoryInput, runHistory } from './history/operations.js'
import { runNotes } from './notes.js'

const scope = Type.Optional(Type.Union([Type.Literal('notes'), Type.Literal('memory')]))
const chatId = Type.Optional(Type.String())
const action = <T extends string>(name: T) => Type.Literal(name)
const notesSchemas = {
  list_files_by_prefix: Type.Object(
    {
      ...ListFilesInput.properties,
      action: action('list_files_by_prefix'),
      scope,
      chat_id: chatId,
    },
    { additionalProperties: false },
  ),
  read_file: Type.Object(
    { ...ReadFileInput.properties, action: action('read_file'), scope, chat_id: chatId },
    { additionalProperties: false },
  ),
  search_contents: Type.Object(
    {
      ...SearchContentsInput.properties,
      action: action('search_contents'),
      scope,
      chat_id: chatId,
    },
    { additionalProperties: false },
  ),
  write_file: Type.Object(
    { ...ChangeFileInput.properties, action: action('write_file'), scope, chat_id: chatId },
    { additionalProperties: false },
  ),
  append_to_file: Type.Object(
    { ...ChangeFileInput.properties, action: action('append_to_file'), scope, chat_id: chatId },
    { additionalProperties: false },
  ),
}
const notesParameters = Type.Object(
  {
    action: StringEnum([
      'list_files_by_prefix',
      'read_file',
      'search_contents',
      'write_file',
      'append_to_file',
    ]),
    chat_id: chatId,
    scope,
    ...ListFilesInput.properties,
    path: Type.Optional(ChangeFileInput.properties.path),
    text: Type.Optional(ChangeFileInput.properties.text),
    expected_version: ChangeFileInput.properties.expected_version,
    start_line: ReadFileInput.properties.start_line,
    stop_line: ReadFileInput.properties.stop_line,
    ...SearchContentsInput.properties,
    query: Type.Optional(SearchContentsInput.properties.query),
  },
  { additionalProperties: false },
)

const optionalString = Type.Optional(Type.Union([Type.String(), Type.Null()]))
const role = Type.Optional(
  Type.Union([
    Type.Literal('user'),
    Type.Literal('assistant'),
    Type.Literal('tool'),
    Type.Literal('system'),
    Type.Literal('developer'),
    Type.Null(),
  ]),
)
const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 100 }))
const recentFirst = Type.Optional(Type.Boolean())
const agentName = optionalString
const filter = {
  chat_id: chatId,
  agent_name: agentName,
  window_id: optionalString,
  role,
  tool_name: optionalString,
  tool_namespace: optionalString,
}
const historySchemas = {
  list_chats: Type.Object(
    { action: action('list_chats'), limit, before_chat_id: Type.Optional(Type.String()) },
    { additionalProperties: false },
  ),
  list_windows: Type.Object(
    {
      action: action('list_windows'),
      chat_id: chatId,
      agent_name: agentName,
      limit,
      recent_first: recentFirst,
    },
    { additionalProperties: false },
  ),
  list_items: Type.Object(
    {
      action: action('list_items'),
      ...filter,
      limit,
      recent_first: recentFirst,
      max_chars_per_item: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000 })),
    },
    { additionalProperties: false },
  ),
  search: Type.Object(
    {
      action: action('search'),
      ...filter,
      scope,
      query: Type.String({ minLength: 1, maxLength: 1024 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      recent_first: recentFirst,
    },
    { additionalProperties: false },
  ),
  read_item: Type.Object(
    {
      action: action('read_item'),
      chat_id: chatId,
      agent_name: agentName,
      window_id: optionalString,
      scope,
      item_id: Type.String(),
      offset_chars: Type.Optional(Type.Integer({ minimum: 0 })),
      limit_chars: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000 })),
    },
    { additionalProperties: false },
  ),
  list_revisions: Type.Object(
    { ...ListRevisionsInput.properties, action: action('list_revisions') },
    { additionalProperties: false },
  ),
  read_revision: Type.Object(
    { ...ReadRevisionInput.properties, action: action('read_revision') },
    { additionalProperties: false },
  ),
}
const historyParameters = Type.Object(
  {
    action: StringEnum([
      'list_chats',
      'list_windows',
      'list_items',
      'search',
      'read_item',
      'list_revisions',
      'read_revision',
    ]),
    ...filter,
    scope,
    limit,
    recent_first: recentFirst,
    before_chat_id: Type.Optional(Type.String()),
    max_chars_per_item: historySchemas.list_items.properties.max_chars_per_item,
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    item_id: Type.Optional(Type.String()),
    offset_chars: historySchemas.read_item.properties.offset_chars,
    limit_chars: historySchemas.read_item.properties.limit_chars,
    path: Type.Optional(Type.String()),
    revision: Type.Optional(ReadRevisionInput.properties.revision),
    offset: ListRevisionsInput.properties.offset,
  },
  { additionalProperties: false },
)

function toolResult(value: unknown, details?: { contextPaths: string[] }) {
  const serialized = JSON.stringify(value)
  const max = 64 * 1024
  const truncated = Buffer.byteLength(serialized, 'utf8') > max
  return {
    content: [
      {
        type: 'text' as const,
        text: truncated
          ? JSON.stringify({
              truncated: true,
              message: 'Result exceeds 64 KiB; narrow filters or read a range',
            })
          : serialized,
      },
    ],
    details: details ?? {},
  }
}

export function parseNotesInput(input: unknown) {
  Value.Parse(notesParameters, input)
  if (
    typeof input !== 'object' ||
    input === null ||
    !('action' in input) ||
    typeof input.action !== 'string' ||
    !(input.action in notesSchemas)
  )
    throw new Error('Invalid notes action')
  switch (input.action) {
    case 'list_files_by_prefix':
      return Value.Parse(notesSchemas.list_files_by_prefix, input)
    case 'read_file':
      return Value.Parse(notesSchemas.read_file, input)
    case 'search_contents':
      return Value.Parse(notesSchemas.search_contents, input)
    case 'write_file':
      return Value.Parse(notesSchemas.write_file, input)
    case 'append_to_file':
      return Value.Parse(notesSchemas.append_to_file, input)
    default:
      throw new Error('Invalid notes action')
  }
}

export function parseHistoryInput(input: unknown): HistoryInput {
  Value.Parse(historyParameters, input)
  if (
    typeof input !== 'object' ||
    input === null ||
    !('action' in input) ||
    typeof input.action !== 'string' ||
    !(input.action in historySchemas)
  )
    throw new Error('Invalid history action')
  switch (input.action) {
    case 'list_chats':
      return Value.Parse(historySchemas.list_chats, input)
    case 'list_windows':
      return Value.Parse(historySchemas.list_windows, input)
    case 'list_items':
      return Value.Parse(historySchemas.list_items, input)
    case 'search':
      return Value.Parse(historySchemas.search, input)
    case 'read_item':
      return Value.Parse(historySchemas.read_item, input)
    case 'list_revisions':
      return Value.Parse(historySchemas.list_revisions, input)
    case 'read_revision':
      return Value.Parse(historySchemas.read_revision, input)
    default:
      throw new Error('Invalid history action')
  }
}

export function registerContextTools(
  pi: ExtensionAPI,
  getAccess: (ctx: ExtensionContext) => ContextAccess,
): ToolDefinition[] {
  const memory: ToolDefinition<typeof notesParameters> = {
    name: 'clawa_memory',
    label: 'Clawa memory',
    description:
      'Read and write shared house Markdown. Scope defaults to memory; notes reads legacy chat checkpoints.',
    parameters: notesParameters,
    async execute(_id, input, signal, _update, ctx) {
      const access = getAccess(ctx)
      const parsed = parseNotesInput(input)
      const { value, contextPaths } = await runNotes(
        access,
        ctx,
        { ...parsed, scope: parsed.scope ?? 'memory' },
        signal ?? new AbortController().signal,
      )
      return toolResult(value, { contextPaths })
    },
  }
  const history: ToolDefinition<typeof historyParameters> = {
    name: 'clawa_history',
    label: 'Clawa history',
    description:
      'Browse local Pi chats, context windows and committed memory revisions. Pass IDs unchanged.',
    parameters: historyParameters,
    async execute(_id, input, signal, _update, ctx) {
      return toolResult(
        await runHistory(
          getAccess(ctx),
          ctx,
          parseHistoryInput(input),
          signal ?? new AbortController().signal,
        ),
      )
    },
  }
  const tools: ToolDefinition[] = [memory, history]
  for (const tool of tools) pi.registerTool(tool)
  return tools
}

export type { ContextAccess }
export { indexCurrentChat }
