import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerNestedAgentsAutoload } from './nested-agents.js'

const CLAWA_NESTED_CONTEXT_PATTERN = /<clawa_nested_agents_context>/
const A_AGENTS_PATTERN = /<agents_file path="a\/AGENTS\.md">\nA/
const AB_AGENTS_PATTERN = /<agents_file path="a\/b\/AGENTS\.md">\nB/
const ROOT_PATTERN = /ROOT/
const TOPIC_AGENTS_PATTERN = /<agents_file path="topic\/AGENTS\.md">\nTOPIC/
const PROJECT_ROOT_PATTERN = /PROJECT ROOT/
const WORKER_ROOT_PATTERN = /WORKER ROOT/

type Handler = (event: any, ctx: any) => any

function createHarness(cwd: string) {
  const handlers = new Map<string, Handler>()
  const notifications: string[] = []
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
  }
  const ctx = {
    cwd,
    hasUI: true,
    ui: { notify: (message: string) => notifications.push(message) },
    sessionManager: { getBranch: () => [] },
  }
  registerNestedAgentsAutoload(pi as any)
  return { handlers, ctx, notifications }
}

function textContent(
  result: { content?: Array<{ type: string; text?: string }> } | undefined,
): string {
  return (result?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
}

test('nested AGENTS load for accessed files while cwd root AGENTS stays out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-nested-agents-'))
  try {
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'ROOT')
    await writeFile(join(root, 'a', 'AGENTS.md'), 'A')
    await writeFile(join(root, 'a', 'b', 'AGENTS.md'), 'B')
    await writeFile(join(root, 'a', 'b', 'file.ts'), 'export const b = 1\n')

    const { handlers, ctx } = createHarness(root)
    handlers.get('session_start')?.({}, ctx)
    const result = await handlers.get('tool_result')?.(
      {
        toolName: 'read',
        isError: false,
        input: { path: join(root, 'a', 'b', 'file.ts') },
        content: [{ type: 'text', text: 'FILE' }],
        details: {},
      },
      ctx,
    )

    const text = textContent(result)
    assert.match(text, CLAWA_NESTED_CONTEXT_PATTERN)
    assert.match(text, A_AGENTS_PATTERN)
    assert.match(text, AB_AGENTS_PATTERN)
    assert.doesNotMatch(text, ROOT_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('worker home excludes inherited project and worker AGENTS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-worker-nested-agents-'))
  try {
    const worker = join(root, 'clawas', 'worker-clawa')
    await mkdir(join(root, '.git'))
    await mkdir(join(worker, 'topic'), { recursive: true })
    await writeFile(join(root, 'AGENTS.md'), 'PROJECT ROOT')
    await writeFile(join(worker, 'AGENTS.md'), 'WORKER ROOT')
    await writeFile(join(worker, 'topic', 'AGENTS.md'), 'TOPIC')
    await writeFile(join(worker, 'topic', 'note.md'), 'hello\n')

    const { handlers, ctx } = createHarness(worker)
    handlers.get('session_start')?.({}, ctx)
    const result = await handlers.get('tool_result')?.(
      {
        toolName: 'exec_command',
        isError: false,
        input: { cmd: 'cat ./topic/note.md' },
        content: [{ type: 'text', text: 'hello' }],
        details: {},
      },
      ctx,
    )

    const text = textContent(result)
    assert.match(text, TOPIC_AGENTS_PATTERN)
    assert.doesNotMatch(text, PROJECT_ROOT_PATTERN)
    assert.doesNotMatch(text, WORKER_ROOT_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
