import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { MaxFileBytes } from '../src/context-management/files/contracts.ts'
import { migrateMemory } from '../src/context-management/migration.ts'

const collisionPattern = /collision/
const irregularPattern = /not a regular file/
const fileLimitPattern = /file limit/

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'clawa-migration-'))
}

test('merges identical vault targets, preserves arbitrary bytes and retries safely', async () => {
  const root = await home()
  try {
    await mkdir(join(root, 'vault', 'media'), { recursive: true })
    await mkdir(join(root, 'vault', 'empty'), { recursive: true })
    await mkdir(join(root, 'memory'), { recursive: true })
    const bytes = Buffer.from([0, 255, 10])
    await writeFile(join(root, 'vault', 'media', 'image.bin'), bytes)
    await writeFile(join(root, 'vault', 'index.md'), 'hello\n')
    await writeFile(join(root, 'memory', 'index.md'), 'hello\n')
    const [first, second] = await Promise.all([
      migrateMemory(root, new AbortController().signal),
      migrateMemory(root, new AbortController().signal),
    ])
    assert.equal(first.vaultFiles + second.vaultFiles, 2)
    assert.equal((await readFile(join(root, 'memory', 'media', 'image.bin'))).equals(bytes), true)
    assert.deepEqual(await readdir(join(root, 'memory', 'empty')), [])
    assert.deepEqual(await readdir(root), ['.pi', 'memory'])
    assert.equal((await migrateMemory(root, new AbortController().signal)).vaultFiles, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a different target or linked source blocks migration without deleting source', async () => {
  const root = await home()
  try {
    await mkdir(join(root, 'vault'))
    await mkdir(join(root, 'memory'))
    await writeFile(join(root, 'vault', 'a.md'), 'old')
    await writeFile(join(root, 'vault', 'b.md'), 'old')
    await writeFile(join(root, 'memory', 'b.md'), 'new')
    await assert.rejects(migrateMemory(root, new AbortController().signal), collisionPattern)
    assert.equal(await readFile(join(root, 'vault', 'a.md'), 'utf8'), 'old')
    assert.equal(await readFile(join(root, 'vault', 'b.md'), 'utf8'), 'old')
    await rm(join(root, 'memory', 'b.md'))
    await symlink(join(root, 'vault', 'a.md'), join(root, 'vault', 'link.md'))
    await assert.rejects(migrateMemory(root, new AbortController().signal), irregularPattern)
    assert.equal(await readFile(join(root, 'vault', 'a.md'), 'utf8'), 'old')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('imports exact legacy row fields without creating or modifying the old database', async () => {
  const root = await home()
  try {
    const absent = await migrateMemory(root, new AbortController().signal)
    assert.equal(absent.legacyDatabase, 'absent')
    assert.equal((await readdir(join(root, '.pi'))).includes('clawa-memory.sqlite'), false)
    const dbPath = join(root, '.pi', 'clawa-memory.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(
      'CREATE TABLE memories (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, text TEXT NOT NULL, tags TEXT NOT NULL)',
    )
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?)').run(
      31,
      123456,
      'line\n-->\n✨',
      '["Exact Tag"]',
    )
    db.close()
    const before = await readFile(dbPath)
    const result = await migrateMemory(root, new AbortController().signal)
    assert.equal(result.legacyRows, 1)
    const payload = JSON.stringify({
      id: 31,
      ts: 123456,
      text: 'line\n-->\n✨',
      tags: '["Exact Tag"]',
    })
    const digest = createHash('sha256').update(payload).digest('hex')
    const path = join(root, 'memory', 'legacy', `31-${digest}.md`)
    assert.equal(await readFile(path, 'utf8'), `${payload}\n`)
    assert.equal((await readFile(dbPath)).equals(before), true)
    assert.equal((await migrateMemory(root, new AbortController().signal)).legacyRows, 0)
    assert.deepEqual(await readdir(join(root, 'memory', 'legacy')), [`31-${digest}.md`])
    const changed = new DatabaseSync(dbPath)
    changed.prepare('UPDATE memories SET text = ? WHERE id = ?').run('edited', 31)
    changed.close()
    assert.equal((await migrateMemory(root, new AbortController().signal)).legacyRows, 1)
    assert.equal((await readdir(join(root, 'memory', 'legacy'))).length, 2)
    assert.equal(await readFile(path, 'utf8'), `${payload}\n`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('oversized legacy JSON fails visibly before installation and retains the source for retry', async () => {
  const root = await home()
  try {
    await mkdir(join(root, '.pi'))
    const dbPath = join(root, '.pi', 'clawa-memory.sqlite')
    const db = new DatabaseSync(dbPath)
    db.exec(
      'CREATE TABLE memories (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, text TEXT NOT NULL, tags TEXT NOT NULL)',
    )
    // Text alone fits; JSON punctuation and the final newline push the file over the shared limit.
    db.prepare('INSERT INTO memories VALUES (?, ?, ?, ?)').run(
      1,
      8,
      'x'.repeat(MaxFileBytes - 1),
      '[]',
    )
    db.close()
    const before = await readFile(dbPath)
    await assert.rejects(migrateMemory(root, new AbortController().signal), fileLimitPattern)
    assert.equal((await readFile(dbPath)).equals(before), true)
    assert.deepEqual(await readdir(join(root, 'memory', 'legacy')), [])

    const retryDb = new DatabaseSync(dbPath)
    retryDb.prepare('UPDATE memories SET text = ? WHERE id = ?').run('short', 1)
    retryDb.close()
    assert.equal((await migrateMemory(root, new AbortController().signal)).legacyRows, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
