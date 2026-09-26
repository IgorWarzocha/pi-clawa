import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type {
  ChangeFileInput,
  ListFilesInput,
  ReadFileInput,
  SearchContentsInput,
} from './files/contracts.js'
import { appendFile, listFiles, readFile, searchFiles, writeFile } from './files/files.js'
import { type ContextAccess, findChat } from './history/catalog.js'

export type NotesAction =
  | ({ action: 'list_files_by_prefix' } & ListFilesInput)
  | ({ action: 'read_file' } & ReadFileInput)
  | ({ action: 'search_contents' } & SearchContentsInput)
  | ({ action: 'write_file' | 'append_to_file' } & ChangeFileInput)

export interface NotesInput {
  scope?: 'notes' | 'memory'
  chat_id?: string
}

function ownedPath(
  path: string | null | undefined,
  agent: string,
  agents: ReadonlySet<string>,
  prefix: boolean,
): string {
  if (!path) return `${agent}/notes${prefix ? '/' : ''}`
  const parts = path.split('/')
  if (parts.length >= 2 && parts[1] === 'notes') {
    if (!agents.has(parts[0] ?? '')) throw new Error(`Unknown agent in this house: ${parts[0]}`)
    return path
  }
  if (parts.length > 1 && agents.has(parts[0] ?? ''))
    throw new Error('Explicit agent paths must include /notes/')
  return `${agent}/notes/${path}`
}

export async function runNotes(
  access: ContextAccess,
  ctx: ExtensionContext,
  input: NotesInput & NotesAction,
  signal: AbortSignal,
): Promise<{ value: unknown; contextPaths: string[] }> {
  if (input.scope === 'memory' && input.chat_id)
    throw new Error('Memory is shared by this house; omit chat_id')
  let root: string
  let agents: ReadonlySet<string> = new Set()
  if (input.scope === 'memory') {
    root = join(access.rootHouse, 'memory')
  } else {
    const chat = await findChat(access, ctx, input.chat_id)
    root = join(access.rootHouse, '.pi', 'context', 'notes', chat.sessionId)
    agents = new Set([
      access.agentName,
      chat.agentName,
      'main',
      ...(access.homes ?? []).map((home) => home.agentName),
    ])
    await mkdir(root, { recursive: true })
  }
  const scoped = (path: string | null | undefined, prefix = false) =>
    input.scope === 'memory' ? path : ownedPath(path, access.agentName, agents, prefix)
  if (input.action === 'list_files_by_prefix' || input.action === 'search_contents')
    return queryNotes(root, input, scoped, signal)
  return changeNotes(root, input, scoped, signal)
}

type ScopedPath = (path: string | null | undefined, prefix?: boolean) => string | null | undefined

async function queryNotes(
  root: string,
  input: Extract<NotesAction, { action: 'list_files_by_prefix' | 'search_contents' }>,
  scoped: ScopedPath,
  signal: AbortSignal,
) {
  if (input.action === 'list_files_by_prefix') {
    const prefix = scoped(input.prefix, true)
    const value = await listFiles(
      root,
      {
        ...(prefix == null ? {} : { prefix }),
        ...(input.max_results === undefined ? {} : { max_results: input.max_results }),
        ...(input.file_order === undefined ? {} : { file_order: input.file_order }),
        ...(input.file_order_by === undefined ? {} : { file_order_by: input.file_order_by }),
      },
      signal,
    )
    return { value, contextPaths: [join(root, prefix ?? '')] }
  }
  const prefix = scoped(input.path_prefix, true)
  const value = await searchFiles(
    root,
    {
      query: input.query,
      ...(prefix == null ? {} : { path_prefix: prefix }),
      ...(input.max_files === undefined ? {} : { max_files: input.max_files }),
      ...(input.max_matches_per_file === undefined
        ? {}
        : { max_matches_per_file: input.max_matches_per_file }),
      ...(input.recent_file_first === undefined
        ? {}
        : { recent_file_first: input.recent_file_first }),
    },
    signal,
  )
  return { value, contextPaths: [join(root, prefix ?? '')] }
}

async function changeNotes(
  root: string,
  input: Exclude<NotesAction, { action: 'list_files_by_prefix' | 'search_contents' }>,
  scoped: ScopedPath,
  signal: AbortSignal,
) {
  const path = scoped(input.path)
  if (!path) throw new Error('File path is required')
  if (input.action === 'read_file') {
    const value = await readFile(
      root,
      {
        path,
        ...(input.start_line === undefined ? {} : { start_line: input.start_line }),
        ...(input.stop_line === undefined ? {} : { stop_line: input.stop_line }),
      },
      signal,
    )
    return { value, contextPaths: [join(root, path)] }
  }
  const change = {
    path,
    text: input.text,
    ...(input.expected_version === undefined ? {} : { expected_version: input.expected_version }),
  }
  const value =
    input.action === 'write_file'
      ? await writeFile(root, change, signal)
      : await appendFile(root, change, signal)
  return { value, contextPaths: [join(root, path)] }
}
