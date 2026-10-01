import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { type ExtensionContext, SessionManager } from '@earendil-works/pi-coding-agent'
import {
  type ContextAccess,
  findChat,
  listCatalog,
} from '../src/context-management/history/catalog.js'
import { extractHistory, readChatEntries } from '../src/context-management/history/entries.js'
import { runHistory } from '../src/context-management/history/operations.js'

const signal = new AbortController().signal
const unknownChat = /Unknown chat_id/
const invalidChat = /Invalid chat_id/
const mismatchedChat = /no longer matches/
const missingArchive = /Archived raw source missing/
const branchCycle = /Session branch cycle/

function context(root: string, sessionManager: SessionManager): ExtensionContext {
  return { cwd: root, sessionManager } as never as ExtensionContext
}

test('catalog reads only declared session directories and rejects foreign chat IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-house-'))
  const foreign = await mkdtemp(join(tmpdir(), 'clawa-foreign-'))
  try {
    const worker = join(root, 'custom-worker-home')
    const workerDir = join(worker, '.pi', 'sessions')
    await mkdir(workerDir, { recursive: true })
    const main = SessionManager.create(root, join(root, '.pi', 'sessions'))
    const other = SessionManager.create(worker, workerDir)
    const alien = SessionManager.create(foreign, join(foreign, '.pi', 'sessions'))
    const user = (manager: SessionManager, text: string) => {
      const id = manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() })
      manager.appendMessage({
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'openai',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      })
      return id
    }
    user(main, 'main start')
    const workerItem = user(other, 'worker start')
    user(alien, 'alien start')
    const access: ContextAccess = {
      rootHouse: root,
      agentName: 'main',
      homes: [{ cwd: worker, agentName: 'worker-id', sessionDir: workerDir }],
    }
    const ctx = context(root, main)
    const records = await listCatalog(access, ctx)
    assert.deepEqual(
      new Set(records.map((record) => record.agentName)),
      new Set(['main', 'worker-id']),
    )
    assert.equal((await findChat(access, ctx, other.getSessionId())).agentName, 'worker-id')
    const read = (await runHistory(
      access,
      ctx,
      { action: 'read_item', scope: 'memory', chat_id: other.getSessionId(), item_id: workerItem },
      signal,
    )) as { content: string }
    assert.equal(read.content, 'worker start')
    await assert.rejects(findChat(access, ctx, alien.getSessionId()), unknownChat)
    await assert.rejects(findChat(access, ctx, '../escape'), invalidChat)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(foreign, { recursive: true, force: true })
  }
})

test('native summary links recover nested archives once, live and after restart, without unrelated branches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-history-archives-'))
  try {
    const dir = join(root, 'sessions')
    const manager = SessionManager.create(root, dir)
    const user = (text: string) =>
      manager.appendMessage({ role: 'user', content: text, timestamp: 1 })
    manager.appendCustomEntry('clawa-context-window', { windowId: 'archived' })
    const shared = user('shared ancestor')
    manager.appendMessage({
      role: 'assistant',
      content: [],
      api: 'openai-responses',
      provider: 'openai',
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
    const first = user('first archived turn')
    const summary = manager.branchWithSummary(null, 'first boundary', { unrelated: true }, true)
    manager.appendCustomEntry('clawa-context-window', { windowId: 'middle' })
    const middle = user('middle turn')
    manager.branch(shared)
    const abandoned = user('unrelated abandoned turn')
    manager.branch(middle)
    const second = user('second archived turn')
    manager.branchWithSummary(null, 'second boundary')
    manager.appendCustomEntry('clawa-context-window', { windowId: 'current' })
    const current = user('current turn')
    const file = manager.getSessionFile()
    assert.ok(file)
    const chat = {
      sessionId: manager.getSessionId(),
      sessionFile: file,
      cwd: root,
      agentName: 'main',
    }
    const other = context(root, SessionManager.inMemory(root))
    const expected = [shared, first, middle, second, current]
    for (const ctx of [
      context(root, manager),
      other,
      context(root, SessionManager.open(file, dir)),
    ]) {
      const entries = await readChatEntries(chat, ctx)
      assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length)
      assert.ok(!entries.some((entry) => entry.id === abandoned))
      const history = extractHistory(chat, entries)
      assert.deepEqual(
        history.items.filter((item) => item.role === 'user').map((item) => item.item_id),
        expected,
      )
      assert.deepEqual(
        history.windows.map((window) => window.window_id),
        ['archived', `${chat.sessionId}:root`, 'middle', 'current'],
      )
    }
    manager.branch(shared)
    assert.deepEqual(
      extractHistory(chat, await readChatEntries(chat, context(root, manager))).items.map(
        (item) => item.item_id,
      ),
      [shared],
    )
    await assert.rejects(
      readChatEntries({ ...chat, cwd: join(root, 'wrong') }, context(root, manager)),
      mismatchedChat,
    )

    const raw = manager.getEntries()
    const write = async (entries: typeof raw) => {
      await writeFile(
        file,
        `${[manager.getHeader(), ...entries].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      )
    }
    await write(raw.filter((entry) => entry.id !== first))
    await assert.rejects(readChatEntries(chat, other), missingArchive)
    await write(
      raw.map((entry) =>
        entry.id === summary && entry.type === 'branch_summary'
          ? { ...entry, fromId: entry.id }
          : entry,
      ),
    )
    await assert.rejects(readChatEntries(chat, other), branchCycle)
    await write(
      raw.map((entry) => (entry.id === current ? { ...entry, parentId: entry.id } : entry)),
    )
    await assert.rejects(readChatEntries(chat, other), branchCycle)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
