import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { type ExtensionContext, SessionManager } from '@earendil-works/pi-coding-agent'
import type { ContextAccess } from '../src/context-management/history/catalog.js'
import { runNotes } from '../src/context-management/notes.js'
import { parseNotesInput } from '../src/context-management/tools.js'

const signal = new AbortController().signal
const unknownAgent = /Unknown agent/
const invalidPath = /cannot contain/
const unknownChat = /Unknown chat_id/
const sharedMemory = /omit chat_id/

test('notes router accepts listing without query, but search and writes require their own fields', () => {
  assert.deepEqual(parseNotesInput({ action: 'list_files_by_prefix' }), {
    action: 'list_files_by_prefix',
  })
  assert.deepEqual(parseNotesInput({ action: 'read_file', path: 'plan.md' }), {
    action: 'read_file',
    path: 'plan.md',
  })
  assert.throws(() => parseNotesInput({ action: 'search_contents' }))
  assert.throws(() => parseNotesInput({ action: 'write_file', path: 'plan.md' }))
  assert.throws(() =>
    parseNotesInput({ action: 'read_file', path: 'plan.md', query: 'not this action' }),
  )
})

test('unflushed chats can write private checkpoints; other chats and unknown agents cannot cross the boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-notes-'))
  try {
    const manager = SessionManager.create(root, join(root, '.pi', 'sessions'))
    const ctx = { cwd: root, sessionManager: manager } as never as ExtensionContext
    const access: ContextAccess = { rootHouse: root, agentName: 'main' }
    const written = await runNotes(
      access,
      ctx,
      { action: 'write_file', path: 'plans/today.md', text: 'first\nsecond' },
      signal,
    )
    assert.deepEqual(written.contextPaths, [
      join(
        root,
        '.pi',
        'context',
        'notes',
        manager.getSessionId(),
        'main',
        'notes',
        'plans',
        'today.md',
      ),
    ])
    await runNotes(
      access,
      ctx,
      { action: 'append_to_file', path: 'plans/today.md', text: '\nthird' },
      signal,
    )
    const read = (await runNotes(
      access,
      ctx,
      { action: 'read_file', path: 'main/notes/plans/today.md', start_line: 2, stop_line: 3 },
      signal,
    )) as { value: { file: { content: string } } }
    assert.equal(read.value.file.content, 'second\nthird')
    await assert.rejects(
      runNotes(access, ctx, { action: 'read_file', path: 'stranger/notes/plans/today.md' }, signal),
      unknownAgent,
    )
    await assert.rejects(
      runNotes(access, ctx, { action: 'read_file', path: '../escape.md' }, signal),
      invalidPath,
    )
    await assert.rejects(
      runNotes(
        access,
        ctx,
        { action: 'read_file', chat_id: 'missing', path: 'plans/today.md' },
        signal,
      ),
      unknownChat,
    )
    await assert.rejects(
      runNotes(
        access,
        ctx,
        {
          action: 'write_file',
          scope: 'memory',
          chat_id: manager.getSessionId(),
          path: 'shared.md',
          text: 'no',
        },
        signal,
      ),
      sharedMemory,
    )
    await writeFile(join(manager.getSessionDir(), 'unrelated.jsonl'), '{broken header\n')
    const afterUnrelatedFailure = (await runNotes(
      access,
      ctx,
      { action: 'read_file', path: 'plans/today.md' },
      signal,
    )) as { value: { file: { content: string } } }
    assert.equal(afterUnrelatedFailure.value.file.content, 'first\nsecond\nthird')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
