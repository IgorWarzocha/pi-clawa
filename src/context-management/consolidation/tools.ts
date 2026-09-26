import { join } from 'node:path'
import { StringEnum } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { ChangeFileInput, ReadFileInput, SearchContentsInput } from '../files/contracts.js'
import { appendFile, listFiles, readFile, searchFiles, writeFile } from '../files/files.js'
import type { ConsolidationJob } from './index.js'

const LOCAL_DOCS = new Set(['CLAW.md', 'CURIOUS.md', 'TOOLS.md'])
const SHARED_DOCS = new Set(['HUMAN.md', 'CLAWAS.md'])

export interface MemoryFileRequest {
  action: 'list' | 'search' | 'read' | 'write' | 'append'
  path?: string
  query?: string
  text?: string
  prefix?: string
  start_line?: number | null
  stop_line?: number | null
  expected_version?: string | null
}

function memoryPrefix(prefix: string | undefined): string | undefined {
  if (prefix === undefined || prefix === 'memory/') return undefined
  if (!prefix.startsWith('memory/'))
    throw new Error('Only shared memory/ can be listed or searched')
  return prefix.slice('memory/'.length)
}

function locate(job: ConsolidationJob, path: string | undefined): { root: string; path: string } {
  if (!path) throw new Error('A memory or living-document path is required')
  if (LOCAL_DOCS.has(path)) return { root: job.cwd, path }
  if (SHARED_DOCS.has(path)) return { root: job.rootHouse, path }
  if (path.startsWith('memory/') && path.length > 'memory/'.length) {
    return { root: join(job.rootHouse, 'memory'), path: path.slice('memory/'.length) }
  }
  throw new Error("Only this Clawa's living documents and shared memory/ are available")
}

async function listMemory(
  job: ConsolidationJob,
  prefixInput: string | undefined,
  signal: AbortSignal,
) {
  const prefix = memoryPrefix(prefixInput)
  const result = await listFiles(
    join(job.rootHouse, 'memory'),
    { ...(prefix ? { prefix } : {}) },
    signal,
  )
  return JSON.stringify({
    ...result,
    files: result.files.map((file) => ({ ...file, path: `memory/${file.path}` })),
  })
}

async function searchMemory(job: ConsolidationJob, input: MemoryFileRequest, signal: AbortSignal) {
  if (!input.query) throw new Error('Search needs a nonempty query')
  const prefix = memoryPrefix(input.prefix)
  const result = await searchFiles(
    join(job.rootHouse, 'memory'),
    { query: input.query, ...(prefix ? { path_prefix: prefix } : {}) },
    signal,
  )
  return JSON.stringify({
    ...result,
    results: result.results.map((file) => ({ ...file, path: `memory/${file.path}` })),
  })
}

/** All agent-chosen paths pass the exact-owner gate before the bounded files engine. */
export async function memoryFileOperation(
  job: ConsolidationJob,
  input: MemoryFileRequest,
  signal: AbortSignal,
): Promise<string> {
  if (input.action === 'list') return listMemory(job, input.prefix, signal)
  if (input.action === 'search') return searchMemory(job, input, signal)
  const target = locate(job, input.path)
  if (input.action === 'read') {
    const result = await readFile(
      target.root,
      {
        path: target.path,
        ...(input.start_line === undefined ? {} : { start_line: input.start_line }),
        ...(input.stop_line === undefined ? {} : { stop_line: input.stop_line }),
      },
      signal,
    )
    return JSON.stringify({ ...result, file: { ...result.file, path: input.path } })
  }
  if (input.action === 'write' || input.action === 'append') {
    return changeMemoryFile(target, input, signal)
  }
  throw new Error('Unknown memory file action')
}

async function changeMemoryFile(
  target: { root: string; path: string },
  input: MemoryFileRequest,
  signal: AbortSignal,
): Promise<string> {
  if (input.text === undefined) throw new Error('Writing memory needs text')
  if (input.action === 'write' && input.expected_version === undefined) {
    throw new Error('Read first and pass expected_version; use null only when creating a new file')
  }
  const operation = input.action === 'write' ? writeFile : appendFile
  await operation(
    target.root,
    {
      path: target.path,
      text: input.text,
      ...(input.expected_version === undefined ? {} : { expected_version: input.expected_version }),
    },
    signal,
  )
  return `Updated ${input.path}`
}

export function memoryFileTool(job: ConsolidationJob, runSignal: AbortSignal) {
  return defineTool({
    name: 'memory_file',
    label: 'Memory file',
    description: "Read, search, and edit this Clawa's living documents and shared memory Markdown",
    parameters: Type.Object({
      action: StringEnum(['list', 'search', 'read', 'write', 'append'] as const),
      path: Type.Optional(
        Type.String({
          description: 'CLAW.md, CURIOUS.md, TOOLS.md, HUMAN.md, CLAWAS.md, or memory/<file>.md',
        }),
      ),
      prefix: Type.Optional(Type.String({ description: 'memory/ prefix for list or search' })),
      query: Type.Optional(SearchContentsInput.properties.query),
      text: Type.Optional(ChangeFileInput.properties.text),
      expected_version: ChangeFileInput.properties.expected_version,
      start_line: ReadFileInput.properties.start_line,
      stop_line: ReadFileInput.properties.stop_line,
    }),
    async execute(_id, params, signal) {
      const content = await memoryFileOperation(
        job,
        params,
        signal ? AbortSignal.any([runSignal, signal]) : runSignal,
      )
      return { content: [{ type: 'text', text: content }], details: undefined }
    },
  })
}
