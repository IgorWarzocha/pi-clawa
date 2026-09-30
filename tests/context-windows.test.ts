import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { extractHistory } from '../src/context-management/history/entries.js'

test('archived Clawa rollover remains readable without replaying local context management', () => {
  const manager = SessionManager.inMemory('/home/test')
  manager.appendCustomEntry('clawa-context-window', { windowId: 'old', agentName: 'main' })
  const oldId = manager.appendMessage({ role: 'user', content: 'old conversation', timestamp: 1 })
  // The retired writer emitted a native boundary followed by this marker.
  manager.appendCompaction(
    'Read your checkpoint',
    null,
    100,
    { strategy: 'clawa-notes-only', windowId: 'next' },
    true,
  )
  manager.appendCustomEntry('clawa-context-window', { windowId: 'next', agentName: 'main' })
  assert.ok(!JSON.stringify(manager.buildSessionProjection().messages).includes('old conversation'))
  manager.appendMessage({ role: 'user', content: 'new conversation', timestamp: 2 })
  const chat = {
    sessionId: manager.getSessionId(),
    sessionFile: '',
    cwd: '/home/test',
    agentName: 'main',
  }
  const archived = extractHistory(chat, manager.getBranch())
  assert.deepEqual(
    archived.windows.map((window) => window.window_id),
    ['old', 'next'],
  )
  assert.equal(archived.items.find((item) => item.item_id === oldId)?.text, 'old conversation')
  assert.equal(archived.items.find((item) => item.text === 'new conversation')?.window_id, 'next')
  assert.deepEqual(
    extractHistory(chat, manager.getBranch(oldId)).windows.map((window) => window.window_id),
    ['old'],
  )
})

test('native Pi compaction creates an archive boundary after legacy windows and reminders', () => {
  const manager = SessionManager.inMemory('/home/test')
  manager.appendCustomEntry('clawa-context-window', { windowId: 'first', agentName: 'main' })
  const noteId = manager.appendCustomMessageEntry(
    'clawa-memory-pass',
    'Legacy checkpoint reminder',
    false,
    { triggerPercent: 90, tokens: 950, contextWindow: 1000 },
  )
  const boundaryId = manager.appendCompaction('Pi summary', null, 950)
  const currentId = manager.appendMessage({ role: 'user', content: 'continue', timestamp: 2 })
  const chat = {
    sessionId: manager.getSessionId(),
    sessionFile: '',
    cwd: '/home/test',
    agentName: 'main',
  }
  const history = extractHistory(chat, manager.getBranch())
  assert.deepEqual(
    history.windows.map((window) => window.window_id),
    ['first', `${chat.sessionId}:${boundaryId}`],
  )
  assert.equal(
    history.items.find((item) => item.item_id === noteId)?.text,
    'Legacy checkpoint reminder',
  )
  assert.equal(
    history.items.find((item) => item.item_id === currentId)?.window_id,
    `${chat.sessionId}:${boundaryId}`,
  )
  assert.equal(extractHistory(chat, manager.getBranch(noteId)).windows.length, 1)
})
