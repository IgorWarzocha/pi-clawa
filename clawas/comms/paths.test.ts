import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { getSocketPath } from './paths.js'

const SESSION_ID = '019ee48f-8976-7a7a-8e14-c68625934c5b'

test('socket paths stay short for long project directories', () => {
  const previous = {
    PI_CLAW_PROJECT_ROOT: process.env.PI_CLAW_PROJECT_ROOT,
    PI_CLAWAS_CONTROL_SOCKET_ROOT: process.env.PI_CLAWAS_CONTROL_SOCKET_ROOT,
    PI_CLAWAS_CONTROL_SOCKET_DIR: process.env.PI_CLAWAS_CONTROL_SOCKET_DIR,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  }

  try {
    const projectRoot = join(
      '/home/igorw/Work/tries',
      '2026-06-20 clawa-cleanroom-bootstrap-with-a-very-long-name',
    )
    process.env.PI_CLAW_PROJECT_ROOT = projectRoot
    process.env.XDG_RUNTIME_DIR = '/run/user/1000'
    delete process.env.PI_CLAWAS_CONTROL_SOCKET_ROOT
    delete process.env.PI_CLAWAS_CONTROL_SOCKET_DIR

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
