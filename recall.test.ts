import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { rememberMemory } from './memory.js'
import { searchRecall } from './recall.js'

function sessionLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

test('recall searches shared memory and current session text while skipping tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-recall-'))
  const previousRoot = process.env.PI_CLAW_PROJECT_ROOT
  try {
    process.env.PI_CLAW_PROJECT_ROOT = root
    const sessionDir = join(root, '.pi', 'sessions')
    await mkdir(sessionDir, { recursive: true })
    const sessionFile = join(sessionDir, 'session.jsonl')

    rememberMemory(root, { text: 'Igor likes banana sparks in memory.', tags: ['human'] })

    await writeFile(
      sessionFile,
      [
        sessionLine({
          type: 'session',
          id: 's1',
          timestamp: '2026-06-19T00:00:00.000Z',
          cwd: root,
        }),
        sessionLine({
          type: 'message',
          id: 'u1',
          parentId: null,
          timestamp: '2026-06-19T00:01:00.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Please remember the banana thread.' }],
          },
        }),
        sessionLine({
          type: 'message',
          id: 'a1',
          parentId: 'u1',
          timestamp: '2026-06-19T00:02:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                id: 'tc1',
                name: 'bash',
                arguments: { command: 'echo tool-banana' },
              },
              { type: 'text', text: 'The banana thread is worth keeping.' },
            ],
          },
        }),
        sessionLine({
          type: 'message',
          id: 'tr1',
          parentId: 'a1',
          timestamp: '2026-06-19T00:03:00.000Z',
          message: { role: 'toolResult', content: [{ type: 'text', text: 'tool-banana' }] },
        }),
        sessionLine({
          type: 'custom_message',
          id: 'c1',
          parentId: 'tr1',
          timestamp: '2026-06-19T00:04:00.000Z',
          customType: 'note',
          content: 'Custom banana note.',
          display: true,
        }),
        sessionLine({
          type: 'compaction',
          id: 'cmp1',
          parentId: 'c1',
          timestamp: '2026-06-19T00:05:00.000Z',
          summary: 'Compaction kept the banana motif.',
          firstKeptEntryId: 'u1',
          tokensBefore: 123,
        }),
      ].join(''),
      'utf8',
    )

    const results = searchRecall({
      cwd: root,
      query: 'banana',
      sessionFiles: [sessionFile],
      limit: 10,
    })
    assert.ok(results.some((result) => result.source === 'memory' && result.id === 1))
    assert.ok(results.some((result) => result.source === 'session' && result.entryId === 'u1'))
    assert.ok(results.some((result) => result.source === 'session' && result.entryId === 'a1'))
    assert.ok(results.some((result) => result.source === 'session' && result.entryId === 'c1'))
    assert.ok(results.some((result) => result.source === 'session' && result.entryId === 'cmp1'))
    assert.ok(results.every((result) => result.entryId !== 'tr1'))
    assert.ok(results.find((result) => result.entryId === 'a1')?.line)

    const toolOnly = searchRecall({ cwd: root, query: 'tool-banana', sessionFiles: [sessionFile] })
    assert.deepEqual(
      toolOnly.map((result) => result.entryId),
      [],
    )
  } finally {
    if (previousRoot === undefined) delete process.env.PI_CLAW_PROJECT_ROOT
    else process.env.PI_CLAW_PROJECT_ROOT = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
