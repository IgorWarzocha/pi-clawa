import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { markClawEnvironmentBootstrapped } from '../src/config.js'
import { HYDRATION_MESSAGE_TYPE } from '../src/extension/constants.js'
import { registerHydrationContext } from '../src/extension/hydration-context.js'
import { ClawaRuntimeState } from '../src/extension/runtime-state.js'
import { registerClawaSessionEvents } from '../src/extension/session-events.js'

type EventHandler = (event: Record<string, unknown>, ctx: TestContext) => unknown
type TestContext = {
  cwd: string
  hasUI: false
  isIdle: () => boolean
  model: { input: Array<'image' | 'text'> }
  sessionManager: { getBranch: () => SessionEntry[] }
  ui: Record<string, never>
}

const HYDRATION_FILES = ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md']
const INITIAL_CLAW_PATTERN = /initial CLAW\.md/
const RESUMED_SHAPE_PATTERN = /resumed shape/
const AFTER_COMPACT_PATTERN = /after compact/
const MID_SESSION_EDIT_PATTERN = /mid-session edit/
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function registerTestRuntime(): {
  branch: SessionEntry[]
  handlers: Map<string, EventHandler[]>
  sent: Array<{ content: unknown; customType: string; display: boolean }>
} {
  const handlers = new Map<string, EventHandler[]>()
  const branch: SessionEntry[] = []
  const sent: Array<{ content: unknown; customType: string; display: boolean }> = []
  let nextId = 1
  const pi = {
    on(name: string, handler: EventHandler) {
      const registered = handlers.get(name) ?? []
      registered.push(handler)
      handlers.set(name, registered)
    },
    sendMessage(message: { content: unknown; customType: string; display: boolean }) {
      sent.push(message)
      const parentId = branch.at(-1)?.id ?? null
      branch.push({
        type: 'custom_message',
        id: `hydration-${nextId++}`,
        parentId,
        timestamp: new Date().toISOString(),
        customType: message.customType,
        content: message.content,
        display: message.display,
      } as SessionEntry)
    },
    sendUserMessage() {},
    setSessionName() {},
  }
  const runtime = new ClawaRuntimeState()

  registerClawaSessionEvents(pi as never, {
    runtime,
    clawasRuntime: { attach() {} } as never,
    pulseRuntime: { attach() {}, dispose() {} } as never,
    commsServer: { async start() {}, async stop() {} } as never,
    setDefaults() {},
  })
  registerHydrationContext(pi as never, runtime, { debugProbe: false })

  return { branch, handlers, sent }
}

async function emit(
  handlers: Map<string, EventHandler[]>,
  name: string,
  event: Record<string, unknown>,
  ctx: TestContext,
): Promise<void> {
  for (const handler of handlers.get(name) ?? []) await handler(event, ctx)
}

function hydrationText(message: { content: unknown } | undefined): string {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block): block is { type: 'text'; text: string } =>
      Boolean(
        block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block &&
          typeof block.text === 'string',
      ),
    )
    .map((block) => block.text)
    .join('\n')
}

function hydrationImages(message: { content: unknown } | undefined): unknown[] {
  if (!Array.isArray(message?.content)) return []
  return message.content.filter(
    (block) => block && typeof block === 'object' && 'type' in block && block.type === 'image',
  )
}

test('hydration persists in branch history and refreshes only at lifecycle boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-hydration-lifecycle-'))
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  const previousSocketRoot = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  const previousSocketDir = process.env['PI_CLAWAS_CONTROL_SOCKET_DIR']

  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    markClawEnvironmentBootstrapped(root)
    for (const name of HYDRATION_FILES) {
      await writeFile(join(root, name), `# ${name}\n\ninitial ${name}\n`, 'utf8')
    }

    const { branch, handlers, sent } = registerTestRuntime()
    const ctx: TestContext = {
      cwd: root,
      hasUI: false,
      isIdle: () => true,
      model: { input: ['text', 'image'] },
      sessionManager: { getBranch: () => branch },
      ui: {},
    }
    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)

    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.customType, HYDRATION_MESSAGE_TYPE)
    assert.equal(sent[0]?.display, false)
    assert.match(hydrationText(sent[0]), INITIAL_CLAW_PATTERN)
    assert.equal(handlers.has('context'), false)

    await writeFile(join(root, 'CLAW.md'), '# CLAW.md\n\nmid-session edit\n', 'utf8')
    assert.doesNotMatch(hydrationText(sent.at(-1)), MID_SESSION_EDIT_PATTERN)

    await writeFile(join(root, 'CLAW.md'), '# CLAW.md\n\nresumed shape\n', 'utf8')
    await emit(handlers, 'session_start', { type: 'session_start', reason: 'resume' }, ctx)
    assert.equal(sent.length, 2)
    assert.match(hydrationText(sent.at(-1)), RESUMED_SHAPE_PATTERN)

    await emit(handlers, 'session_start', { type: 'session_start', reason: 'resume' }, ctx)
    assert.equal(sent.length, 2)

    await writeFile(join(root, 'HUMAN.md'), '# HUMAN.md\n\nafter compact\n', 'utf8')
    await writeFile(join(root, 'CLAWA.PNG'), Buffer.from(TINY_PNG_BASE64, 'base64'))
    branch.splice(0, branch.length)
    await emit(
      handlers,
      'session_compact',
      { type: 'session_compact', reason: 'overflow', willRetry: true },
      ctx,
    )
    assert.equal(sent.length, 3)
    assert.match(hydrationText(sent.at(-1)), AFTER_COMPACT_PATTERN)
    assert.equal(hydrationImages(sent.at(-1)).length, 1)

    await emit(
      handlers,
      'session_compact',
      { type: 'session_compact', reason: 'manual', willRetry: false },
      ctx,
    )
    assert.equal(sent.length, 3)
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    if (previousSocketRoot === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previousSocketRoot
    if (previousSocketDir === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_DIR']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_DIR'] = previousSocketDir
    await rm(root, { recursive: true, force: true })
  }
})
