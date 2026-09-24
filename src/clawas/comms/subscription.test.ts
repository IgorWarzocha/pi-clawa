import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getClawasSessionStatus, watchClawasSession } from './client.js'
import { ensureControlDir, getSocketPath } from './paths.js'
import { ClawasStatusState } from './status.js'

const SESSION_ID = 'status-boundary'
const IDENTITY_PATTERN = /worker identity changed/u
const UPGRADE_PATTERN = /upgrade or restart/u
const CLOSED_PATTERN = /closed/u

async function withControlSocket(
  run: (sockets: Set<Socket>) => Promise<void>,
  onRequest: (socket: Socket, request: string) => void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'clawas-status-'))
  const previous = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.once('data', (chunk) => onRequest(socket, String(chunk)))
  })
  try {
    await ensureControlDir()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(getSocketPath(SESSION_ID), resolve)
    })
    await run(sockets)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previous === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previous
    await rm(root, { recursive: true, force: true })
  }
}

test('status stream starts with a snapshot, carries ordered changes, and closes on failure', async () => {
  const state = new ClawasStatusState()
  let idle = true
  const ctx = {
    cwd: '/work',
    isIdle: () => idle,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => SESSION_ID, getSessionFile: () => '/session.jsonl' },
  }
  let subscriber: Socket | undefined
  await withControlSocket(
    async () => {
      const states: string[] = []
      let receivedUpdate: () => void = () => assert.fail('missing update')
      const update = new Promise<void>((resolve) => {
        receivedUpdate = resolve
      })
      let observedClose: (error: Error) => void = () => assert.fail('missing close')
      const closed = new Promise<Error>((resolve) => {
        observedClose = resolve
      })
      const subscription = await watchClawasSession(SESSION_ID, {
        onStatus(status) {
          states.push(`${status.isIdle}:${status.currentToolName ?? ''}`)
          if (status.currentToolName) receivedUpdate()
        },
        onClose(error) {
          observedClose(error)
        },
      })
      assert.deepEqual(states, ['true:'])
      idle = false
      state.toolStart('call-1', 'exec')
      subscriber?.write(`${JSON.stringify({ type: 'status', status: state.snapshot(ctx) })}\n`)
      await update
      assert.deepEqual(states, ['true:', 'false:exec'])
      subscriber?.destroy()
      assert.match((await closed).message, CLOSED_PATTERN)
      subscription.close()
    },
    (socket, request) => {
      if (!request.includes('subscribe_status')) return
      subscriber = socket
      socket.write(
        `${JSON.stringify({ type: 'response', command: 'subscribe_status', success: true, data: state.snapshot(ctx) })}\n`,
      )
    },
  )
})

test('callback identity failure closes a live subscription, while malformed legacy status fails visibly', async () => {
  let subscriber: Socket | undefined
  await withControlSocket(
    async () => {
      let observedClose: (error: Error) => void = () => assert.fail('missing close')
      const closed = new Promise<Error>((resolve) => {
        observedClose = resolve
      })
      const subscription = await watchClawasSession(SESSION_ID, {
        onStatus(status) {
          if (status.currentToolName) throw new Error('worker identity changed')
        },
        onClose(error) {
          observedClose(error)
        },
      })
      subscriber?.write(
        `${JSON.stringify({ type: 'status', status: { ...initial, currentToolName: 'exec' } })}\n`,
      )
      assert.match((await closed).message, IDENTITY_PATTERN)
      subscription.close()
      await assert.rejects(getClawasSessionStatus(SESSION_ID), UPGRADE_PATTERN)
    },
    (socket, request) => {
      if (request.includes('subscribe_status')) {
        subscriber = socket
        socket.write(
          `${JSON.stringify({ type: 'response', command: 'subscribe_status', success: true, data: initial })}\n`,
        )
      } else if (request.includes('get_status')) {
        socket.end(
          `${JSON.stringify({ type: 'response', command: 'get_status', success: true, data: { isIdle: true, hasPendingMessages: false } })}\n`,
        )
      }
    },
  )
})

const initial = {
  sessionId: SESSION_ID,
  cwd: '/work',
  isIdle: true,
  hasPendingMessages: false,
  lastSummary: '',
  updatedAt: 42,
}

test('overlapping tool completions preserve the active tool', () => {
  const state = new ClawasStatusState()
  const ctx = {
    cwd: '/work',
    isIdle: () => false,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => SESSION_ID, getSessionFile: () => undefined },
  }
  state.toolStart('first', 'read')
  assert.equal(state.snapshot(ctx, true).hasPendingMessages, true)
  state.toolStart('second', 'write')
  state.toolEnd('first', 'read', false)
  assert.equal(state.snapshot(ctx).currentToolName, 'write')
  state.toolEnd('second', 'write', true)
  assert.equal(state.snapshot(ctx).currentToolName, undefined)
  assert.equal(state.snapshot(ctx).lastError, 'write failed')
})
