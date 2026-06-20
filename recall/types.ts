type RecallSource = 'memory' | 'session'
export type SessionRole = 'user' | 'assistant' | 'custom' | 'compaction' | 'branch'

interface RecallQuery {
  query?: string
  tags?: string[]
  limit?: number
}

export interface RecallSearchInput extends RecallQuery {
  cwd: string
  sessionFiles?: string[]
}

export interface RecallResult {
  source: RecallSource
  score: number
  timestamp: number
  text: string
  tags?: string[]
  id?: number
  sessionFile?: string
  line?: number
  entryId?: string
  role?: SessionRole
  label: string
}
