import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  archiveDiscordHistoryMessage,
  type DiscordHistoryEntry,
  markDiscordHistoryMessageDeleted,
} from './history.js'

type ArchiveWrite = { entry: DiscordHistoryEntry } | { deleted: string }

/** Write-ahead journal: delivery and intake may continue only after local retention. */
export class DiscordArchive {
  private readonly path: string
  private readonly projectRoot: string
  private readonly health: (failure: string | undefined) => void
  private pending: ArchiveWrite[] = []
  private retained = true

  constructor(projectRoot: string, health: (failure: string | undefined) => void) {
    this.projectRoot = projectRoot
    this.health = health
    this.path = resolve(projectRoot, '.pi/clawa-discord/archive-pending.json')
    if (existsSync(this.path)) {
      const saved: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!(Array.isArray(saved) && saved.every(isArchiveWrite))) {
        throw new Error(`Invalid Discord archive journal: ${this.path}`)
      }
      this.pending = saved
    }
  }

  archive(entry: DiscordHistoryEntry): void {
    if (!entry.sourceMessageId)
      throw new Error('Retried Discord writes require a source message ID.')
    this.accept({ entry })
  }

  delete(messageId: string): void {
    this.accept({ deleted: messageId })
  }

  flush(): void {
    try {
      if (!this.retained) this.persist()
      for (const write of this.pending) {
        if ('entry' in write) archiveDiscordHistoryMessage(this.projectRoot, write.entry)
        else markDiscordHistoryMessageDeleted(this.projectRoot, write.deleted)
      }
      if (this.pending.length > 0) {
        // Clear disk first; replaying an already-applied write is harmless.
        this.persist([])
        this.pending = []
      }
      this.health(undefined)
    } catch (error) {
      this.health(`Archive failed (${this.pending.length} pending): ${errorText(error)}`)
      if (!this.retained) throw error
    }
  }

  private accept(write: ArchiveWrite): void {
    this.pending.push(write)
    this.retained = false
    this.flush()
  }

  private persist(writes = this.pending): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(writes)}\n`, { mode: 0o600, flush: true })
    renameSync(temporary, this.path)
    this.retained = true
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isArchiveWrite(value: unknown): value is ArchiveWrite {
  if (typeof value !== 'object' || value === null) return false
  if ('deleted' in value) return typeof value.deleted === 'string'
  if (!('entry' in value) || typeof value.entry !== 'object' || value.entry === null) return false
  const entry = value.entry
  return (
    ['channelId', 'channelName', 'senderId', 'senderName', 'content', 'timestamp'].every(
      (key) => typeof Reflect.get(entry, key) === 'string',
    ) &&
    ['user', 'assistant', 'reaction'].includes(String(Reflect.get(entry, 'role'))) &&
    typeof Reflect.get(entry, 'sourceMessageId') === 'string'
  )
}
