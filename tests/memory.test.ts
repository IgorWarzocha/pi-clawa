import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { rememberMemories, rememberMemory, resolveMemoryDbPath } from '../src/memory.js'

function readMemories(path: string): Array<{ id: number; text: string; tags: string }> {
  const db = new DatabaseSync(path)
  try {
    const rows = db.prepare('SELECT id, text, tags FROM memories ORDER BY id').all() as Array<{
      id: number
      text: string
      tags: string
    }>
    return rows.map((row) => ({ id: row.id, text: row.text, tags: row.tags }))
  } finally {
    db.close()
  }
}

test('remember creates updates and deletes shared sqlite memories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-'))
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    process.env['PI_CLAW_PROJECT_ROOT'] = root
    const workerCwd = join(root, 'clawas', 'research-clawa')
    const dbPath = resolveMemoryDbPath(workerCwd)

    const created = rememberMemory(workerCwd, {
      text: 'The human prefers few concepts over many files.',
      tags: ['Human', 'taste', 'taste'],
    })
    assert.equal(created.action, 'created')
    assert.equal(created.path, dbPath)

    assert.deepEqual(readMemories(dbPath), [
      {
        id: created.id,
        text: 'The human prefers few concepts over many files.',
        tags: '["human","taste"]',
      },
    ])

    const updated = rememberMemory(root, {
      id: created.id,
      text: 'The human prefers few concepts and low-bloat systems.',
      tags: ['human', 'low bloat'],
    })
    assert.equal(updated.action, 'updated')
    assert.deepEqual(readMemories(dbPath), [
      {
        id: created.id,
        text: 'The human prefers few concepts and low-bloat systems.',
        tags: '["human","low-bloat"]',
      },
    ])

    const deleted = rememberMemory(workerCwd, { id: created.id, text: '' })
    assert.equal(deleted.action, 'deleted')
    assert.deepEqual(readMemories(dbPath), [])
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})

test('compaction memories commit as one SQLite batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-batch-'))
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    process.env['PI_CLAW_PROJECT_ROOT'] = root
    const dbPath = resolveMemoryDbPath(root)
    rememberMemory(root, { text: 'existing memory' })

    const db = new DatabaseSync(dbPath)
    try {
      db.exec(`
        CREATE TRIGGER reject_memory BEFORE INSERT ON memories
        WHEN NEW.text = 'reject me'
        BEGIN
          SELECT RAISE(ABORT, 'rejected by test');
        END;
      `)
    } finally {
      db.close()
    }

    assert.throws(() =>
      rememberMemories(root, [{ text: 'would be partial' }, { text: 'reject me' }]),
    )
    assert.deepEqual(
      readMemories(dbPath).map((memory) => memory.text),
      ['existing memory'],
    )
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
