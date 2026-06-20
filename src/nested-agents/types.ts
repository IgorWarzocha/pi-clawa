export const DETAILS_KEY = 'clawaNestedAgentsContext'
export const LINE_SPLIT_REGEX = /\r?\n/
export const GREP_OUTPUT_PATH_REGEX = /^(.+?):\d+(?::\d+)?:/
export const WHITESPACE_REGEX = /\s/
export const MAX_OUTPUT_LINES = 250
export const REFRESH_EVERY = 10

export type TextContent = { type: 'text'; text: string }
export type ToolContent = { type: string; text?: string }
export type PersistedAgentsFile = { path: string; content: string }
export type PersistedAgentsDetails = { files: PersistedAgentsFile[] }

export type ToolResultLike = {
  toolName: string
  input: Record<string, unknown>
  content: ToolContent[]
  isError: boolean
  details?: unknown
}

export type ReadAppendixResult = {
  appendixFiles: PersistedAgentsFile[]
  failedFiles: Array<{ agentsPath: string; error: Error }>
  loadedNow: string[]
  persistedFiles: PersistedAgentsFile[]
}
