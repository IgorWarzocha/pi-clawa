import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_CLAWA_DEFAULTS } from '../config.js'
import { ensureControlDir, getSocketPath } from './comms/paths.js'
import { parseClawasCommsCommand } from './comms/protocol.js'
import type { ClawasSessionStatus } from './comms/types.js'
import type { LaunchOptions } from './panel-command.js'
import type { PanelHandle } from './panel-host.js'
import { ClawasPanelWorker } from './panel-worker.js'
import { readWorkerSession, recordWorkerSession } from './session-registry.js'
import type { WorkerState } from './types.js'

const UNAVAILABLE_PATTERN = /panel is open but its Clawa connection is unavailable/u
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
async function serveSession(cwd: string, sessionFile: string): Promise<() => Promise<void>> {
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

test('concurrent launch and main shutdown preserve one panel for the next main session', async () => {
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
    assert.equal(await next.focus('panel'), '%2')
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

test('an existing live panel without control does not launch a duplicate or get closed', async () => {
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
        assert.fail('closed a previously owned panel')
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
