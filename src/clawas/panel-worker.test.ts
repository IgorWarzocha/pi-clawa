import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_CLAWA_DEFAULTS } from '../config.js'
import type { SharedResidentContext } from './comms/context-protocol.js'
import { ensureControlDir, getSocketPath } from './comms/paths.js'
import { parseClawasCommsCommand } from './comms/protocol.js'
import type { ClawasCommsCommand, ClawasSessionStatus } from './comms/types.js'
import type { LaunchOptions } from './panel-command.js'
import type { PanelHandle } from './panel-host.js'
import { ClawasPanelWorker } from './panel-worker.js'
import { readWorkerSession, recordWorkerSession } from './session-registry.js'
import type { PrepareResidentContext } from './shared-context.js'
import type { WorkerState } from './types.js'

const UNAVAILABLE_PATTERN = /tab is open but its Clawa connection is unavailable/u
const BINDING_ERROR_PATTERN = /binding failed/u
const PREPARE_ERROR_PATTERN = /prepare failed/u
const STALE_MAIN_PATTERN = /Main Clawa session changed/u
const SHARED_CONTEXT = { sessionId: 'family', agentName: '/root/helper' }
const DEFINITION = { id: 'helper', title: 'Helper', cwd: '.', enabled: true, autostart: true }

function panelHandle(sessionFile: string): PanelHandle {
  return {
    host: 'tmux',
    paneId: '%2',
    panePid: '100',
    socket: '/tmux',
    serverPid: '10',
    sessionFile,
  }
}

function initialState(cwd: string): WorkerState {
  return { definition: DEFINITION, cwd, status: 'stopped', lastSummary: '', updatedAt: 0 }
}

// This fixture speaks Clawa's own socket contract, not a simulated terminal or Pi API.
async function serveSession(
  cwd: string,
  sessionFile: string,
  onCommand?: (command: ClawasCommsCommand, status: ClawasSessionStatus) => void,
): Promise<() => Promise<void>> {
  const sockets = new Set<Socket>()
  const status: ClawasSessionStatus = {
    workerId: DEFINITION.id,
    sessionId: 'session',
    sessionFile,
    cwd,
    isIdle: true,
    hasPendingMessages: false,
    lastSummary: '',
    updatedAt: 1,
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const parsed = parseClawasCommsCommand(JSON.parse(buffer.slice(0, index)))
      buffer = buffer.slice(index + 1)
      if ('error' in parsed) {
        socket.destroy(new Error(parsed.error))
        return
      }
      onCommand?.(parsed.value, status)
      socket.write(
        `${JSON.stringify({ type: 'response', command: parsed.value.type, success: true, data: status })}\n`,
      )
    })
  })
  await ensureControlDir()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(getSocketPath(DEFINITION.id), resolve)
  })
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('concurrent launch and main shutdown preserve one tab for the next main session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clp-'))
  const previousRoot = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
  const cwd = join(root, 'helper')
  await mkdir(cwd)
  const controlPlaneRoot = join(root, '.pi', 'clawas')
  const opening = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let launches = 0
  let closes = 0
  let focused: string | undefined
  let stopServer: (() => Promise<void>) | undefined
  const launcher = {
    async open(launch: LaunchOptions) {
      launches += 1
      opening.resolve()
      await release.promise
      stopServer = await serveSession(cwd, launch.sessionFile)
      return panelHandle(launch.sessionFile)
    },
    async close() {
      closes += 1
    },
    async focus(handle: PanelHandle) {
      focused = handle.paneId
    },
    async isAlive() {
      return true
    },
  }
  const options = {
    projectRoot: root,
    controlPlaneRoot,
    extensionPaths: [],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    launcher,
    onChange() {},
  }
  const first = new ClawasPanelWorker({ ...options, state: initialState(cwd) })
  const adoptedState = initialState(cwd)
  const next = new ClawasPanelWorker({ ...options, state: adoptedState })
  try {
    const discovery = first.connect(false)
    const launch = first.connect(true)
    const concurrent = first.connect(true)
    await opening.promise
    const shutdown = first.dispose()
    release.resolve()
    await Promise.all([discovery, launch, concurrent, shutdown])
    assert.equal(launches, 1)
    assert.equal(closes, 0)
    const saved = await readWorkerSession(controlPlaneRoot, DEFINITION.id)
    assert.equal(saved?.panel?.paneId, '%2')

    await next.connect(false)
    assert.equal(adoptedState.status, 'idle')
    await next.focus()
    assert.equal(focused, '%2')
    assert.equal(launches, 1)
    assert.equal(closes, 0)
  } finally {
    release.resolve()
    await Promise.all([first.dispose(), next.dispose()])
    await stopServer?.()
    if (previousRoot === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})

async function residentFixture(
  prepareResidentContext: PrepareResidentContext,
  beforeReady?: () => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'clp-'))
  const previousRoot = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
  const events: string[] = []
  const published: { sharedContext: SharedResidentContext | undefined } = {
    sharedContext: undefined,
  }
  const state = initialState(root)
  state.definition = { ...DEFINITION, startupPrompt: 'startup' }
  const sessionFile = join(root, 'actual-session.jsonl')
  let stopServer: (() => Promise<void>) | undefined
  const worker = new ClawasPanelWorker({
    state,
    projectRoot: root,
    controlPlaneRoot: root,
    extensionPaths: [],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    prepareResidentContext,
    onChange() {},
    launcher: {
      async open(launch: LaunchOptions) {
        events.push('open')
        await beforeReady?.()
        stopServer = await serveSession(root, sessionFile, (command, status) => {
          status.sharedContext = published.sharedContext
          events.push(command.type === 'send' ? command.message : command.type)
        })
        return panelHandle(launch.sessionFile)
      },
      async close() {
        events.push('close')
        await stopServer?.()
        stopServer = undefined
      },
      async focus() {},
      async isAlive() {
        return false
      },
    },
  })
  return {
    root,
    worker,
    state,
    events,
    published,
    sessionFile,
    async cleanup() {
      await worker.dispose()
      await stopServer?.()
      if (previousRoot === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
      else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previousRoot
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('fresh resident sharing precedes launch and gates startup and concurrent first tasks', async () => {
  const prepared = Promise.withResolvers<void>()
  const releasePreparation = Promise.withResolvers<void>()
  const accepting = Promise.withResolvers<ClawasSessionStatus>()
  const releaseAcceptance = Promise.withResolvers<void>()
  let preparations = 0
  const fixture = await residentFixture(async (workerId) => {
    preparations += 1
    assert.equal(workerId, DEFINITION.id)
    prepared.resolve()
    await releasePreparation.promise
    return {
      async accept(status) {
        accepting.resolve(status)
        await releaseAcceptance.promise
        fixture.published.sharedContext = SHARED_CONTEXT
        return SHARED_CONTEXT
      },
    }
  })
  try {
    const first = fixture.worker.sendPrompt('first task', 'prompt')
    await prepared.promise
    assert.deepEqual(fixture.events, [])
    const concurrent = fixture.worker.connect(true)
    releasePreparation.resolve()
    const ready = await accepting.promise
    assert.equal(ready.sessionFile, fixture.sessionFile)
    assert.equal(ready.cwd, fixture.root)
    assert.equal(ready.sessionId, 'session')
    const second = fixture.worker.sendPrompt('second task', 'prompt')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(fixture.events, ['open', 'get_status'])
    releaseAcceptance.resolve()
    await Promise.all([first, second, concurrent])
    assert.equal(preparations, 1)
    assert.deepEqual(fixture.state.sharedContext, SHARED_CONTEXT)
    assert.deepEqual(fixture.events.slice(0, 4), [
      'open',
      'get_status',
      'subscribe_status',
      'startup',
    ])
    assert.deepEqual(fixture.events.slice(4).sort(), ['first task', 'second task'])
  } finally {
    releasePreparation.resolve()
    releaseAcceptance.resolve()
    await fixture.cleanup()
  }
})

test('resident acceptance failure closes only its new panel and clears its registry handle', async () => {
  const fixture = await residentFixture(async () => ({
    async accept() {
      throw new Error('binding failed')
    },
  }))
  try {
    await assert.rejects(fixture.worker.sendPrompt('first task', 'prompt'), BINDING_ERROR_PATTERN)
    assert.deepEqual(fixture.events, ['open', 'get_status', 'close'])
    assert.equal(fixture.state.panel, undefined)
    assert.equal((await readWorkerSession(fixture.root, DEFINITION.id))?.panel, undefined)
    assert.equal(fixture.state.status, 'error')
    // No surviving subscription may make a failed binding look connected.
    await assert.rejects(fixture.worker.connect(true), BINDING_ERROR_PATTERN)
    assert.equal(fixture.events.filter((event) => event === 'close').length, 2)
  } finally {
    await fixture.cleanup()
  }
})

test('resident preparation failure keeps its reserved fresh path without opening a panel', async () => {
  const fixture = await residentFixture(async () => {
    throw new Error('prepare failed')
  })
  try {
    await assert.rejects(fixture.worker.connect(true), PREPARE_ERROR_PATTERN)
    const first = await readWorkerSession(fixture.root, DEFINITION.id)
    await assert.rejects(fixture.worker.connect(true), PREPARE_ERROR_PATTERN)
    assert.equal((await readWorkerSession(fixture.root, DEFINITION.id))?.path, first?.path)
    assert.deepEqual(fixture.events, [])
  } finally {
    await fixture.cleanup()
  }
})

test('a header-only resumed session and an existing live session bypass resident sharing', async () => {
  const fixture = await residentFixture(async () => assert.fail('rebound an existing session'))
  const adoptedState = initialState(fixture.root)
  const adopted = new ClawasPanelWorker({
    state: adoptedState,
    projectRoot: fixture.root,
    controlPlaneRoot: fixture.root,
    extensionPaths: [],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    prepareResidentContext: async () => assert.fail('prepared sharing for a live session'),
    onChange() {},
    launcher: {
      async open() {
        return assert.fail('relaunched a live session')
      },
      async close() {
        assert.fail('closed an adopted session')
      },
      async focus() {},
      async isAlive() {
        return true
      },
    },
  })
  try {
    fixture.published.sharedContext = SHARED_CONTEXT
    await writeFile(
      fixture.sessionFile,
      `${JSON.stringify({ type: 'session', cwd: fixture.root })}\n`,
    )
    await recordWorkerSession(
      fixture.root,
      DEFINITION,
      fixture.root,
      fixture.sessionFile,
      undefined,
    )
    await fixture.worker.sendPrompt('resumed task', 'prompt')
    await adopted.connect(true)
    assert.deepEqual(adoptedState.sharedContext, SHARED_CONTEXT)
    assert.equal(fixture.events.filter((event) => event === 'open').length, 1)
    assert.ok(fixture.events.includes('resumed task'))
  } finally {
    await adopted.dispose()
    await fixture.cleanup()
  }
})

test('main shutdown during resident preparation does not launch or adopt a stale resident', async () => {
  const preparing = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const fixture = await residentFixture(async () => {
    preparing.resolve()
    await release.promise
    return {
      async accept() {
        assert.fail('stale adoption')
      },
    }
  })
  try {
    const delivery = fixture.worker.sendPrompt('stale task', 'prompt')
    const rejected = assert.rejects(delivery, STALE_MAIN_PATTERN)
    await preparing.promise
    const shutdown = fixture.worker.dispose()
    release.resolve()
    await Promise.all([rejected, shutdown])
    assert.deepEqual(fixture.events, [])
  } finally {
    release.resolve()
    await fixture.cleanup()
  }
})

test('main shutdown during acceptance never delivers startup or tasks after sharing finishes', async () => {
  const accepting = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const fixture = await residentFixture(async () => ({
    async accept() {
      accepting.resolve()
      await release.promise
      return SHARED_CONTEXT
    },
  }))
  try {
    const delivery = fixture.worker.sendPrompt('stale task', 'prompt')
    const rejected = assert.rejects(delivery, STALE_MAIN_PATTERN)
    await accepting.promise
    const shutdown = fixture.worker.dispose()
    release.resolve()
    await Promise.all([rejected, shutdown])
    assert.deepEqual(fixture.events, ['open', 'get_status'])
    assert.equal(fixture.state.sharedContext, undefined)
    assert.ok((await readWorkerSession(fixture.root, DEFINITION.id))?.panel)
  } finally {
    release.resolve()
    await fixture.cleanup()
  }
})

test('main shutdown during launch skips resident adoption when the new socket becomes ready', async () => {
  const opening = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const fixture = await residentFixture(
    async () => ({
      async accept() {
        return assert.fail('stale adoption')
      },
    }),
    async () => {
      opening.resolve()
      await release.promise
    },
  )
  try {
    const delivery = fixture.worker.sendPrompt('stale task', 'prompt')
    const rejected = assert.rejects(delivery, STALE_MAIN_PATTERN)
    await opening.promise
    const shutdown = fixture.worker.dispose()
    release.resolve()
    await Promise.all([rejected, shutdown])
    assert.deepEqual(fixture.events, ['open', 'get_status'])
  } finally {
    release.resolve()
    await fixture.cleanup()
  }
})

test('an existing live tab without control does not launch a duplicate or get closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clp-'))
  const previousRoot = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
  const state = initialState(root)
  const sessionFile = join(root, 'session.jsonl')
  const handle = panelHandle(sessionFile)
  const worker = new ClawasPanelWorker({
    state,
    projectRoot: root,
    controlPlaneRoot: root,
    extensionPaths: [],
    clawaDefaults: DEFAULT_CLAWA_DEFAULTS,
    onChange() {},
    launcher: {
      async open() {
        return assert.fail('duplicate launch')
      },
      async close() {
        assert.fail('closed a previously owned tab')
      },
      async focus() {},
      async isAlive() {
        return true
      },
    },
  })
  try {
    await recordWorkerSession(root, DEFINITION, root, sessionFile, handle)
    await assert.rejects(() => worker.connect(true), UNAVAILABLE_PATTERN)
    assert.equal(state.status, 'error')
    assert.deepEqual((await readWorkerSession(root, DEFINITION.id))?.panel, handle)
  } finally {
    await worker.dispose()
    if (previousRoot === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
