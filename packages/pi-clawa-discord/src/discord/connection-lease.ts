import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** An OS-backed lease releases on crash, without PID files or stale-lock deletion races. */
export function acquireBotConnection(token: string): () => void {
  if (!token.trim()) throw new Error('A Discord bot token is required.')
  const directory = join(tmpdir(), `pi-clawa-discord-${process.getuid?.() ?? 'user'}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const key = createHash('sha256').update(token.trim()).digest('hex')
  const db = new DatabaseSync(join(directory, `${key}.sqlite`))
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    db.close()
    if (
      error instanceof Error &&
      'errcode' in error &&
      (error.errcode === 5 || error.errcode === 6)
    ) {
      throw new Error('This Discord bot is already connected in another Pi session.', {
        cause: error,
      })
    }
    throw error
  }
  let released = false
  return () => {
    if (released) return
    db.close()
    released = true
  }
}
