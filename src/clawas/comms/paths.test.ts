import assert from 'node:assert/strict'
import { mkdtemp, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { watchClawasSession } from './client.js'
import { getSocketPath } from './paths.js'
import { ClawasCommsServer } from './server.js'

const SESSION_ID = '019ee48f-8976-7a7a-8e14-c68625934c5b'
const CLOSED_PATTERN = /closed/u

test('socket paths stay short for long project directories', () => {
  const previous = {
    PI_CLAW_PROJECT_ROOT: process.env['PI_CLAW_PROJECT_ROOT'],
    PI_CLAWAS_CONTROL_SOCKET_ROOT: process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'],
    PI_CLAWAS_CONTROL_SOCKET_DIR: process.env['PI_CLAWAS_CONTROL_SOCKET_DIR'],
    XDG_RUNTIME_DIR: process.env['XDG_RUNTIME_DIR'],
  }

  try {
    const projectRoot = join(
      '/home/igorw/Work/tries',
      '2026-06-20 clawa-cleanroom-bootstrap-with-a-very-long-name',
    )
    process.env['PI_CLAW_PROJECT_ROOT'] = projectRoot
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000'
    delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    delete process.env['PI_CLAWAS_CONTROL_SOCKET_DIR']

    const socketPath = getSocketPath(SESSION_ID)

    assert.equal(socketPath.startsWith(projectRoot), false)
    assert.ok(socketPath.length < 104, socketPath)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('alias sync follows session start and serialized stop removes the alias', {
  timeout: 5_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-comms-alias-'))
  const previous = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
  let alias = 'initial'
  const server = new ClawasCommsServer({} as never, () => alias)
  const aliasPath = (name: string) => join(root, 'clawas-control', `${name}.alias`)
  const context = {
    cwd: '/work',
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => SESSION_ID, getSessionFile: () => undefined },
  } as never
  try {
    await server.start(context)
    assert.equal(await readlink(aliasPath('initial')), `${SESSION_ID}.sock`)
    alias = 'updated'
    await server.start(context)
    assert.equal(await readlink(aliasPath('updated')), `${SESSION_ID}.sock`)
    let disconnected: (error: Error) => void = () => assert.fail('missing disconnect')
    const closed = new Promise<Error>((resolve) => {
      disconnected = resolve
    })
    const subscription = await watchClawasSession(SESSION_ID, {
      onStatus() {},
      onClose(error) {
        disconnected(error)
      },
    })
    await server.stop()
    assert.match((await closed).message, CLOSED_PATTERN)
    subscription.close()
    await assert.rejects(() => readlink(aliasPath('initial')), { code: 'ENOENT' })
    await assert.rejects(() => readlink(aliasPath('updated')), { code: 'ENOENT' })
    await assert.rejects(() => readlink(getSocketPath(SESSION_ID)), { code: 'ENOENT' })
    const restarting = server.start(context)
    const stopping = server.stop()
    await Promise.all([restarting, stopping])
    await assert.rejects(() => readlink(aliasPath('updated')), { code: 'ENOENT' })
  } finally {
    await server.stop()
    if (previous === undefined) delete process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
    else process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = previous
    await rm(root, { recursive: true, force: true })
  }
})
