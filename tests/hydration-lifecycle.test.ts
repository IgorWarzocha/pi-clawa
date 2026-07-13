import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
  ui: Record<string, never>
}

const HYDRATION_FILES = ['CLAW.md', 'HUMAN.md', 'CLAWAS.md', 'CURIOUS.md', 'TOOLS.md']
const INITIAL_CLAW_PATTERN = /initial CLAW\.md/
const RESUMED_SHAPE_PATTERN = /resumed shape/
const STALE_COPY_PATTERN = /stale copy/
const AFTER_COMPACT_PATTERN = /after compact/
const MID_SESSION_EDIT_PATTERN = /mid-session edit/

function registerTestRuntime(): {
  handlers: Map<string, EventHandler[]>
  pi: Record<string, unknown>
} {
  const handlers = new Map<string, EventHandler[]>()
  const pi = {
    on(name: string, handler: EventHandler) {
      const registered = handlers.get(name) ?? []
      registered.push(handler)
      handlers.set(name, registered)
    },
    sendMessage() {},
    sendUserMessage() {},
    setSessionName() {},
  }
  const runtime = new ClawaRuntimeState()

  registerHydrationContext(pi as never, runtime, { debugProbe: false })
  registerClawaSessionEvents(pi as never, {
    runtime,
    clawasRuntime: { attach() {} } as never,
    pulseRuntime: { attach() {}, dispose() {} } as never,
    commsServer: { async start() {}, async stop() {} } as never,
    setDefaults() {},
  })

  return { handlers, pi }
}

async function emit(
  handlers: Map<string, EventHandler[]>,
  name: string,
  event: Record<string, unknown>,
  ctx: TestContext,
): Promise<unknown> {
  let result: unknown
  for (const handler of handlers.get(name) ?? []) {
    const next = await handler(event, ctx)
    if (next !== undefined) result = next
  }
  return result
}

async function transformContext(
  handlers: Map<string, EventHandler[]>,
  messages: unknown[],
  ctx: TestContext,
): Promise<unknown[]> {
  let current = messages
  for (const handler of handlers.get('context') ?? []) {
    const result = (await handler({ type: 'context', messages: current }, ctx)) as
      | { messages?: unknown[] }
      | undefined
    if (result?.messages) current = result.messages
  }
  return current
}

function hydrationMessages(messages: unknown[]): Array<{ content: string }> {
  return messages.filter((message): message is { content: string } & Record<string, unknown> =>
    Boolean(
      message &&
        typeof message === 'object' &&
        'customType' in message &&
        message.customType === HYDRATION_MESSAGE_TYPE,
    ),
  )
}

test('hydration stays singular across provider calls and refreshes on resume and compaction', async () => {
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

    const { handlers } = registerTestRuntime()
    const ctx: TestContext = { cwd: root, hasUI: false, isIdle: () => true, ui: {} }
    await emit(handlers, 'session_start', { type: 'session_start', reason: 'startup' }, ctx)

    const firstCall = await transformContext(handlers, [{ role: 'user', content: 'hello' }], ctx)
    await writeFile(join(root, 'CLAW.md'), '# CLAW.md\n\nmid-session edit\n', 'utf8')
    const secondCall = await transformContext(
      handlers,
      [
        { role: 'user', content: 'hello' },
        { role: 'toolResult', content: 'result' },
      ],
      ctx,
    )
    assert.equal(hydrationMessages(firstCall).length, 1)
    assert.equal((firstCall[0] as { customType?: string }).customType, HYDRATION_MESSAGE_TYPE)
    assert.equal(hydrationMessages(secondCall).length, 1)
    assert.match(hydrationMessages(secondCall)[0]?.content ?? '', INITIAL_CLAW_PATTERN)
    assert.doesNotMatch(hydrationMessages(secondCall)[0]?.content ?? '', MID_SESSION_EDIT_PATTERN)

    await writeFile(join(root, 'CLAW.md'), '# CLAW.md\n\nresumed shape\n', 'utf8')
    await emit(handlers, 'session_start', { type: 'session_start', reason: 'resume' }, ctx)
    const resumed = await transformContext(
      handlers,
      [
        ...secondCall,
        { role: 'custom', customType: HYDRATION_MESSAGE_TYPE, content: 'stale copy' },
      ],
      ctx,
    )
    assert.equal(hydrationMessages(resumed).length, 1)
    assert.match(hydrationMessages(resumed)[0]?.content ?? '', RESUMED_SHAPE_PATTERN)
    assert.doesNotMatch(hydrationMessages(resumed)[0]?.content ?? '', STALE_COPY_PATTERN)

    await writeFile(join(root, 'HUMAN.md'), '# HUMAN.md\n\nafter compact\n', 'utf8')
    await emit(
      handlers,
      'session_compact',
      { type: 'session_compact', reason: 'overflow', willRetry: true },
      ctx,
    )
    const compacted = await transformContext(handlers, resumed, ctx)
    const compactFollowUp = await transformContext(handlers, compacted, ctx)
    assert.equal(hydrationMessages(compacted).length, 1)
    assert.equal(hydrationMessages(compactFollowUp).length, 1)
    assert.match(hydrationMessages(compactFollowUp)[0]?.content ?? '', AFTER_COMPACT_PATTERN)

    const emptyRoot = join(root, 'empty-home')
    await mkdir(join(emptyRoot, '.pi'), { recursive: true })
    markClawEnvironmentBootstrapped(emptyRoot)
    const emptyCtx: TestContext = { ...ctx, cwd: emptyRoot }
    await emit(handlers, 'session_start', { type: 'session_start', reason: 'resume' }, emptyCtx)
    const emptyHome = await transformContext(handlers, compactFollowUp, emptyCtx)
    assert.equal(hydrationMessages(emptyHome).length, 0)
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
