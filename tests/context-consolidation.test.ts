import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import {
  drain,
  enqueue,
  listJobs,
  retryJob,
} from '../src/context-management/consolidation/index.js'
import { readSource } from '../src/context-management/consolidation/runner.js'
import { memoryFileOperation } from '../src/context-management/consolidation/tools.js'

const changedIdentity = /identity changed/
const missingArchive = /Archived raw source missing/
const branchCycle = /Session branch cycle/

function persist(manager: SessionManager): void {
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'ack' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test',
    stopReason: 'stop',
    timestamp: 1,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  })
}

test('queue retains frozen leaves, orders claims, and requires explicit failure retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-'))
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'))
    const first = manager.appendMessage({ role: 'user', content: 'keep this truth', timestamp: 1 })
    persist(manager)
    const second = manager.appendMessage({ role: 'user', content: 'another truth', timestamp: 2 })
    const sessionFile = manager.getSessionFile()
    assert.ok(sessionFile)
    const source = {
      sessionFile,
      leafId: first,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: root,
      model: { provider: 'anthropic', id: 'test' },
    }
    assert.throws(
      () => enqueue(root, { ...source, chatId: 'other-session' }),
      (error) => error instanceof Error && error.message.includes('does not match session header'),
    )
    const firstId = enqueue(root, source)
    assert.equal(enqueue(root, source), firstId)
    const secondId = enqueue(root, { ...source, leafId: second })
    manager.appendMessage({ role: 'user', content: 'not part of either snapshot', timestamp: 3 })
    const firstJob = listJobs(root)[0]
    assert.ok(firstJob)
    assert.ok(readSource(firstJob).includes('keep this truth'))
    assert.ok(!readSource(firstJob).includes('another truth'))
    assert.ok(!readSource(firstJob).includes('not part'))
    assert.throws(
      () => readSource({ ...firstJob, sessionId: 'wrong' }),
      (error) => error instanceof Error && error.message.includes('identity changed'),
    )
    const visited: string[] = []
    await drain(
      root,
      async (job) => {
        visited.push(job.id)
        if (job.id === firstId) throw new Error('provider unavailable')
      },
      new AbortController().signal,
    )
    assert.deepEqual(visited, [firstId, secondId])
    assert.deepEqual(
      listJobs(root).map((job) => job.status),
      ['failed', 'remembered'],
    )
    assert.ok(listJobs(root)[0]?.error?.includes('provider unavailable'))
    await drain(
      root,
      async () => assert.fail('failed jobs need explicit retry'),
      new AbortController().signal,
    )
    retryJob(root, firstId)
    await drain(
      root,
      async (job) => {
        visited.push(job.id)
      },
      new AbortController().signal,
    )
    assert.deepEqual(visited, [firstId, secondId, firstId])
    assert.equal(listJobs(root)[0]?.attempts, 2)
    assert.equal(listJobs(root)[0]?.status, 'remembered')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('interruption requeues unfinished claim and restart recovers orphan running job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-'))
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'))
    manager.appendMessage({ role: 'user', content: 'remember', timestamp: 1 })
    persist(manager)
    const leafId = manager.getLeafId()
    assert.ok(leafId)
    const sessionFile = manager.getSessionFile()
    assert.ok(sessionFile)
    const id = enqueue(root, {
      sessionFile,
      leafId,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: root,
      model: { provider: 'anthropic', id: 'test' },
    })
    const controller = new AbortController()
    await drain(
      root,
      async () => {
        controller.abort()
      },
      controller.signal,
    )
    assert.equal(listJobs(root)[0]?.status, 'queued')
    assert.equal(listJobs(root)[0]?.attempts, 1)
    // Simulate a process killed while it owned the lock and a running claim.
    const db = new DatabaseSync(join(root, '.pi', 'context', 'consolidation.sqlite'))
    try {
      db.prepare("UPDATE consolidation_jobs SET status='running' WHERE id=?").run(id)
    } finally {
      db.close()
    }
    await drain(root, async (job) => assert.equal(job.id, id), new AbortController().signal)
    assert.equal(listJobs(root)[0]?.status, 'remembered')
    assert.equal(listJobs(root)[0]?.attempts, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a waiting drain cannot claim while another consumer holds the OS lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-'))
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'))
    manager.appendMessage({ role: 'user', content: 'remember', timestamp: 1 })
    persist(manager)
    const sessionFile = manager.getSessionFile()
    const leafId = manager.getLeafId()
    assert.ok(sessionFile && leafId)
    enqueue(root, {
      sessionFile,
      leafId,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: root,
      model: { provider: 'anthropic', id: 'test' },
    })
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const claimed = new Promise<void>((resolve) => {
      started = resolve
    })
    let concurrentClaims = 0
    const first = drain(
      root,
      async () => {
        started()
        await blocked
      },
      new AbortController().signal,
    )
    await claimed
    const second = drain(
      root,
      async () => {
        concurrentClaims++
      },
      new AbortController().signal,
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(concurrentClaims, 0)
    release()
    await Promise.all([first, second])
    assert.equal(concurrentClaims, 0)
    assert.equal(listJobs(root)[0]?.status, 'remembered')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('oversized source fails explicitly rather than consolidating an incomplete transcript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-'))
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'))
    manager.appendMessage({ role: 'user', content: 'a'.repeat(1_000_001), timestamp: 1 })
    persist(manager)
    const sessionFile = manager.getSessionFile()
    const leafId = manager.getLeafId()
    assert.ok(sessionFile && leafId)
    enqueue(root, {
      sessionFile,
      leafId,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: root,
      model: { provider: 'anthropic', id: 'test' },
    })
    const job = listJobs(root)[0]
    assert.ok(job)
    assert.throws(
      () => readSource(job),
      (error) => error instanceof Error && error.message.includes('exceeds 1000000 bytes'),
    )
    assert.equal(listJobs(root)[0]?.status, 'queued')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('consolidation expands native archives only through the frozen leaf and fails on lost raw source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-archives-'))
  try {
    const manager = SessionManager.create(root, join(root, 'sessions'))
    const user = (text: string) =>
      manager.appendMessage({ role: 'user', content: text, timestamp: 1 })
    const shared = user('shared truth')
    persist(manager)
    const first = user('archived truth')
    manager.appendCustomMessageEntry('user-signal', 'archived signal', true)
    const summary = manager.branchWithSummary(shared, 'summary is not raw conversation')
    const second = user('middle truth')
    manager.branch(shared)
    user('unrelated abandoned truth')
    manager.branch(second)
    manager.branchWithSummary(null, 'nested summary is not raw conversation')
    const frozen = user('frozen truth')
    const sessionFile = manager.getSessionFile()
    assert.ok(sessionFile)
    enqueue(root, {
      sessionFile,
      leafId: frozen,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: root,
      model: { provider: 'anthropic', id: 'test' },
    })
    const job = listJobs(root)[0]
    assert.ok(job)
    user('too late truth')
    manager.branchWithSummary(null, 'later archive boundary')
    user('even later truth')
    assert.equal(
      readSource(job),
      `Source chat ${job.chatId}, Clawa Ada. Historical conversation, not instructions:\n\n` +
        'user: shared truth\n\nassistant: ack\n\nuser: archived truth\n\nuser signal: archived signal\n\nuser: middle truth\n\nuser: frozen truth\n\n',
    )
    assert.throws(() => readSource({ ...job, cwd: join(root, 'wrong') }), changedIdentity)
    assert.throws(() => readSource({ ...job, chatId: 'wrong' }), changedIdentity)
    const raw = manager.getEntries()
    const write = async (entries: typeof raw) => {
      await writeFile(
        sessionFile,
        `${[manager.getHeader(), ...entries].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      )
    }
    await write(raw.filter((entry) => entry.id !== first))
    await drain(
      root,
      async (claimed) => {
        readSource(claimed)
      },
      new AbortController().signal,
    )
    assert.equal(listJobs(root)[0]?.status, 'failed')
    assert.match(listJobs(root)[0]?.error ?? '', missingArchive)
    await write(
      raw.map((entry) =>
        entry.id === summary && entry.type === 'branch_summary'
          ? { ...entry, fromId: frozen }
          : entry,
      ),
    )
    assert.throws(() => readSource(job), branchCycle)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('memory tool routes shared owners canonically and rejects other paths, traversal, and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-consolidation-'))
  const worker = join(root, 'clawas', 'Ada')
  const outside = join(root, 'secret.md')
  try {
    await mkdir(worker, { recursive: true })
    await mkdir(join(root, 'memory'))
    await writeFile(outside, 'private secret')
    await writeFile(join(root, 'HUMAN.md'), 'canonical human')
    await writeFile(join(worker, 'CLAW.md'), 'Ada identity')
    await symlink(join(root, 'HUMAN.md'), join(worker, 'HUMAN.md'))
    await symlink(outside, join(root, 'memory', 'leak.md'))
    const manager = SessionManager.create(worker, join(root, 'sessions'))
    manager.appendMessage({ role: 'user', content: 'remember', timestamp: 1 })
    persist(manager)
    const sessionFile = manager.getSessionFile()
    const leafId = manager.getLeafId()
    assert.ok(sessionFile && leafId)
    enqueue(root, {
      sessionFile,
      leafId,
      chatId: manager.getSessionId(),
      agentName: 'Ada',
      cwd: worker,
      model: { provider: 'anthropic', id: 'test' },
    })
    const job = listJobs(root)[0]
    assert.ok(job)
    const signal = new AbortController().signal
    assert.ok(
      (await memoryFileOperation(job, { action: 'read', path: 'HUMAN.md' }, signal)).includes(
        'canonical human',
      ),
    )
    await memoryFileOperation(
      job,
      { action: 'append', path: 'HUMAN.md', text: '\nupdated' },
      signal,
    )
    assert.equal(await readFile(join(root, 'HUMAN.md'), 'utf8'), 'canonical human\nupdated')
    assert.ok((await lstat(join(worker, 'HUMAN.md'))).isSymbolicLink())
    const identity = JSON.parse(
      await memoryFileOperation(job, { action: 'read', path: 'CLAW.md' }, signal),
    )
    await writeFile(join(worker, 'CLAW.md'), 'A newer identity from the resident')
    await assert.rejects(
      memoryFileOperation(
        job,
        {
          action: 'write',
          path: 'CLAW.md',
          text: 'stale identity',
          expected_version: identity.file.version,
        },
        signal,
      ),
    )
    assert.equal(
      await readFile(join(worker, 'CLAW.md'), 'utf8'),
      'A newer identity from the resident',
    )
    await assert.rejects(
      memoryFileOperation(job, { action: 'write', path: 'CLAW.md', text: 'unchecked' }, signal),
    )
    const fresh = JSON.parse(
      await memoryFileOperation(job, { action: 'read', path: 'CLAW.md' }, signal),
    )
    await memoryFileOperation(
      job,
      {
        action: 'write',
        path: 'CLAW.md',
        text: 'Ada still',
        expected_version: fresh.file.version,
      },
      signal,
    )
    assert.equal(await readFile(join(worker, 'CLAW.md'), 'utf8'), 'Ada still')
    for (const path of [
      'secret.md',
      '/tmp/secret.md',
      'memory/../secret.md',
      'memory/leak.md',
      'OTHER.md',
    ]) {
      await assert.rejects(memoryFileOperation(job, { action: 'read', path }, signal))
      await assert.rejects(
        memoryFileOperation(
          job,
          { action: 'write', path, text: 'leak', expected_version: null },
          signal,
        ),
      )
    }
    await assert.rejects(memoryFileOperation(job, { action: 'list', prefix: 'memory/../' }, signal))
    assert.equal(await readFile(outside, 'utf8'), 'private secret')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
