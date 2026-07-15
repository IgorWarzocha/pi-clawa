import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatDiscordReplyContext,
  readDiscordReplyContext,
} from './src/gateway/discord/reply-context.js'

interface FakeMessageOptions {
  id: string
  authorId?: string
  authorName?: string
  content?: string
  parentId?: string
  attachments?: string[]
}

function createReplyHarness() {
  const messages = new Map<string, any>()
  const channel = {
    messages: {
      fetch: async (id: string) => {
        const message = messages.get(id)
        if (!message) throw new Error('missing')
        return message
      },
    },
  }
  const makeMessage = (options: FakeMessageOptions) => ({
    id: options.id,
    channelId: 'channel',
    channel,
    content: options.content ?? options.id,
    author: {
      id: options.authorId ?? options.id,
      displayName: options.authorName ?? options.id,
      username: options.authorName ?? options.id,
    },
    member: null,
    reference: options.parentId ? { messageId: options.parentId, channelId: 'channel' } : null,
    attachments: new Map(
      (options.attachments ?? []).map((name, index) => [String(index), { name }]),
    ),
  })
  return { messages, makeMessage }
}

test('Discord reply context is short, chronological, and explicit', async () => {
  const { messages, makeMessage } = createReplyHarness()
  const oldest = makeMessage({
    id: 'oldest',
    authorName: 'JosXa',
    content: 'the bit being discussed',
  })
  const parent = makeMessage({
    id: 'parent',
    authorId: 'bot',
    authorName: 'Howaclawa',
    content: 'my actual answer',
    parentId: 'oldest',
    attachments: ['poster.png'],
  })
  messages.set(oldest.id, oldest)
  messages.set(parent.id, parent)

  const reply = await readDiscordReplyContext(
    makeMessage({
      id: 'current',
      authorName: 'Igor',
      content: 'what?',
      parentId: 'parent',
    }) as never,
    'bot',
  )
  assert.equal(reply.isReplyToBot, true)
  assert.equal(reply.immediateAuthor, 'Howaclawa')
  assert.deepEqual(
    reply.entries.map((entry) => entry.messageId),
    ['oldest', 'parent'],
  )
  assert.equal(
    formatDiscordReplyContext(reply.entries),
    [
      'Reply context (oldest → newest):',
      '- JosXa: the bit being discussed',
      '- Howaclawa: my actual answer [attached: poster.png]',
    ].join('\n'),
  )
})

test('Discord reply context stops safely at cycles, missing parents, and four messages', async () => {
  const { messages, makeMessage } = createReplyHarness()
  for (const [id, parentId] of [
    ['p1', undefined],
    ['p2', 'p1'],
    ['p3', 'p2'],
    ['p4', 'p3'],
    ['p5', 'p4'],
  ] as const) {
    messages.set(
      id,
      makeMessage({
        id,
        ...(parentId ? { parentId } : {}),
        content: id === 'p4' ? 'x'.repeat(500) : id,
      }),
    )
  }

  const bounded = await readDiscordReplyContext(
    makeMessage({ id: 'current', parentId: 'p5' }) as never,
    'bot',
  )
  assert.deepEqual(
    bounded.entries.map((entry) => entry.messageId),
    ['p2', 'p3', 'p4', 'p5'],
  )
  assert.ok((bounded.entries.find((entry) => entry.messageId === 'p4')?.content.length ?? 0) <= 360)

  messages.set('cycle-a', makeMessage({ id: 'cycle-a', parentId: 'cycle-b' }))
  messages.set('cycle-b', makeMessage({ id: 'cycle-b', parentId: 'cycle-a' }))
  const cyclic = await readDiscordReplyContext(
    makeMessage({ id: 'cycle-current', parentId: 'cycle-a' }) as never,
    'bot',
  )
  assert.deepEqual(
    cyclic.entries.map((entry) => entry.messageId),
    ['cycle-b', 'cycle-a'],
  )

  const missing = await readDiscordReplyContext(
    makeMessage({ id: 'missing-current', parentId: 'gone' }) as never,
    'bot',
  )
  assert.deepEqual(missing.entries, [])
})
