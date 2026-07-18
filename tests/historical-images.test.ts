import assert from 'node:assert/strict'
import test from 'node:test'
import { boundHistoricalImages } from '../src/extension/historical-images.js'

const OMITTED_IMAGE_PATTERN = /Earlier image omitted from replay/u
const image = (data: string) => ({ type: 'image', mimeType: 'image/png', data })

function imageData(messages: unknown[]): string[] {
  return messages.flatMap((message) => {
    if (!(message && typeof message === 'object' && 'content' in message)) return []
    const content = message.content
    if (!Array.isArray(content)) return []
    return content.flatMap((block) =>
      block &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'image' &&
      'data' in block
        ? [String(block.data)]
        : [],
    )
  })
}

test('provider replay keeps only tail images and leaves the persisted session untouched', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'old' }, image('old-user')] },
    { role: 'toolResult', content: [image('old-tool')] },
    {
      role: 'user',
      content: [{ type: 'text', text: 'compare these' }, image('fresh-a'), image('fresh-b')],
    },
    { role: 'toolResult', content: [image('tool-a')] },
    { role: 'toolResult', content: [image('tool-b')] },
    { role: 'toolResult', content: [image('tool-c')] },
  ]

  const bounded = boundHistoricalImages(messages)

  assert.deepEqual(imageData(bounded), ['fresh-a', 'fresh-b', 'tool-c'])
  assert.match(JSON.stringify(bounded), OMITTED_IMAGE_PATTERN)
  assert.deepEqual(imageData(messages), [
    'old-user',
    'old-tool',
    'fresh-a',
    'fresh-b',
    'tool-a',
    'tool-b',
    'tool-c',
  ])
})

test('provider replay returns the original array when images exist only at the tail', () => {
  const messages = [
    { role: 'user', content: 'look' },
    { role: 'toolResult', content: [image('one'), image('two')] },
  ]

  assert.equal(boundHistoricalImages(messages), messages)
})

test('processed images make one stable transition without churning the older prefix', () => {
  const firstTurn = [
    { role: 'user', content: [{ type: 'text', text: 'look' }, image('user-image')] },
    { role: 'toolResult', content: [image('tool-one')] },
  ]
  const firstReplay = boundHistoricalImages(firstTurn)
  const secondReplay = boundHistoricalImages([
    ...firstTurn,
    { role: 'toolResult', content: [image('tool-two')] },
  ])

  assert.equal(JSON.stringify(secondReplay[0]), JSON.stringify(firstReplay[0]))
  assert.match(JSON.stringify(secondReplay[1]), OMITTED_IMAGE_PATTERN)
  assert.deepEqual(imageData(secondReplay), ['user-image', 'tool-two'])
})
