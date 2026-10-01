import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { PanelHandle } from './panel-host.js'
import { ClawasPanelLauncher } from './panel-launcher.js'

test('only confirmed server death makes a tmux handle stale when tmux cannot be probed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clp-probe-'))
  const previousPath = process.env['PATH']
  const exited = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = exited.pid
  await once(exited, 'close')
  assert.ok(pid)
  const handle: PanelHandle = {
    host: 'tmux',
    paneId: '%2',
    panePid: '100',
    socket: join(root, 'gone-tmux-socket'),
    serverPid: String(pid),
    sessionFile: join(root, 'session.jsonl'),
  }
  const launcher = new ClawasPanelLauncher()
  try {
    // The empty directory guarantees ENOENT without depending on installed terminal tooling.
    process.env['PATH'] = root
    assert.equal(await launcher.isAlive(handle), false)
    await assert.rejects(launcher.isAlive({ ...handle, serverPid: String(process.pid) }), {
      code: 'ENOENT',
    })
    // A malformed persisted PID must not probe a process group or count as confirmed death.
    for (const serverPid of ['0', '-1', 'invalid', '999999999999999999999']) {
      await assert.rejects(launcher.isAlive({ ...handle, serverPid }), { code: 'ENOENT' })
    }
  } finally {
    if (previousPath === undefined) delete process.env['PATH']
    else process.env['PATH'] = previousPath
    await rm(root, { recursive: true, force: true })
  }
})
