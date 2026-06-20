type RecallSource = 'memory' | 'session'
export type SessionRole = 'user' | 'assistant' | 'custom' | 'compaction' | 'branch'

interface RecallQuery {
  query?: string | undefined
  tags?: string[] | undefined
  limit?: number | undefined
}

export interface RecallSearchInput extends RecallQuery {
  cwd: string
  sessionFiles?: string[] | undefined
}

export interface RecallResult {
  source: RecallSource
  score: number
  timestamp: number
  text: string
  tags?: string[] | undefined
  id?: number | undefined
  sessionFile?: string | undefined
  line?: number | undefined
  entryId?: string | undefined
  role?: SessionRole | undefined
  label: string
}
