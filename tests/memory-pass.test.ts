import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContextUsage } from '@earendil-works/pi-coding-agent'
import {
  createMemoryPassState,
  MEMORY_PASS_MESSAGE_TYPE,
  MEMORY_PASS_PROMPT,
  registerMemoryPass,
  shouldRequestMemoryPass,
} from '../src/memory-pass.js'

const CONFIG = { enabled: true, triggerPercent: 90 }

function usage(tokens: number | null, contextWindow = 272_000): ContextUsage {
  return {
    tokens,
    contextWindow,
    percent: tokens === null ? null : (tokens / contextWindow) * 100,
  }
}

test('memory pass follows the active model window without owning compaction', () => {
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(244_799), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(244_800), true), true)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(115_200, 128_000), true), true)
  assert.equal(shouldRequestMemoryPass({ ...CONFIG, enabled: false }, usage(250_000), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(null), true), false)
  assert.equal(shouldRequestMemoryPass(CONFIG, usage(250_000), false), false)
})

test('memory pass nudges the same branch once and rearms after native compaction', async () => {
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>()
  const messages: Array<{ message: Record<string, unknown>; options?: Record<string, unknown> }> =
    []
  let currentUsage = usage(244_799)
  const pi = {
    on(name: string, handler: (event: unknown, ctx: any) => unknown) {
      const registered = handlers.get(name) ?? []
      registered.push(handler)
      handlers.set(name, registered)
    },
    sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>) {
      messages.push({ message, ...(options ? { options } : {}) })
    },
  }
  const state = registerMemoryPass(pi as never, () => CONFIG, createMemoryPassState())
  const ctx = {
    getContextUsage: () => currentUsage,
    hasUI: false,
  }
  const emit = async (name: string) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name }, ctx)
  }

  await emit('agent_settled')
  assert.equal(messages.length, 0)

  currentUsage = usage(244_800)
  await emit('agent_settled')
  await emit('agent_settled')
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.message['customType'], MEMORY_PASS_MESSAGE_TYPE)
  assert.equal(messages[0]?.message['content'], MEMORY_PASS_PROMPT)
  assert.deepEqual(messages[0]?.options, { triggerTurn: true, deliverAs: 'followUp' })
  assert.equal(state.isArmed(), false)

  await emit('session_compact')
  await emit('agent_settled')
  assert.equal(messages.length, 2)
  assert.equal(state.isArmed(), false)
})

test('memory pass asks for recent comparison and permits no new memory', () => {
  assert.equal(MEMORY_PASS_PROMPT.includes('recall with no query and limit 5'), true)
  assert.equal(MEMORY_PASS_PROMPT.includes('updating an existing memory by its id'), true)
  assert.equal(MEMORY_PASS_PROMPT.includes("Don't repeat what is already there"), true)
  assert.equal(MEMORY_PASS_PROMPT.includes('fewer—or none—is completely fine'), true)
  assert.equal(MEMORY_PASS_PROMPT.includes('Pi will handle the actual compaction'), true)
})
