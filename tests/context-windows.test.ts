import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { MemoryPass } from '../src/context-management/memory-pass.js'
import { currentWindow, rolloverDrafts } from '../src/context-management/windows.js'

test('notes-only rollover uses a native boundary without deleting canonical history', () => {
  const manager = SessionManager.inMemory('/home/test')
  manager.appendCustomEntry('clawa-context-window', { windowId: 'old', agentName: 'main' })
  const oldId = manager.appendMessage({ role: 'user', content: 'old conversation', timestamp: 1 })
  for (const draft of rolloverDrafts(
    { windowId: 'next', agentName: 'main' },
    'chat',
    '/home/test',
  )) {
    if (draft.type === 'compaction')
      manager.appendCompaction(draft.summary, draft.firstKeptEntryId, 100, draft.details, true)
    else if (draft.type === 'custom') manager.appendCustomEntry(draft.customType, draft.data)
    else assert.fail('Unexpected rollover draft')
  }
  assert.ok(manager.getBranch().some((entry) => entry.id === oldId))
  assert.deepEqual(currentWindow(manager.getBranch()), { windowId: 'next', agentName: 'main' })
  assert.ok(!JSON.stringify(manager.buildSessionProjection().messages).includes('old conversation'))
  assert.ok(
    JSON.stringify(manager.buildSessionProjection().messages).includes('Read your checkpoint'),
  )
  manager.appendMessage({ role: 'user', content: 'new conversation', timestamp: 2 })
  assert.ok(JSON.stringify(manager.buildSessionProjection().messages).includes('new conversation'))
  assert.equal(currentWindow(manager.getBranch(oldId))?.windowId, 'old')
})

test('ordinary Pi compaction ends the local window and reminder state follows the selected branch', () => {
  const manager = SessionManager.inMemory('/home/test')
  manager.appendCustomEntry('clawa-context-window', { windowId: 'first', agentName: 'main' })
  const pass = new MemoryPass()
  const config = { enabled: true, triggerPercent: 90 }
  const usage = { tokens: 950, contextWindow: 1000, percent: 95 }
  const draft = pass.request(config, usage, 'completed')
  assert.ok(draft)
  const noteId = manager.appendCustomMessageEntry(
    draft.customType,
    draft.content,
    draft.display,
    draft.details,
  )
  const restored = new MemoryPass()
  restored.restore(manager.getBranch())
  assert.equal(restored.request(config, usage, 'completed'), undefined)
  manager.appendCompaction('Pi emergency summary', null, 950)
  assert.equal(currentWindow(manager.getBranch()), undefined)
  restored.restore(manager.getBranch())
  assert.ok(restored.request(config, usage, 'completed'))
  restored.restore(manager.getBranch(noteId))
  assert.equal(restored.request(config, usage, 'completed'), undefined)
})
