import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePanelHandle } from './panel-host.js'

const INVALID_HANDLE = /Invalid Clawas panel handle/

test('persisted handles cannot authorize closing a pane without its launch identity', () => {
  const herdr = {
    host: 'herdr',
    paneId: 'w1:p3',
    tabId: 'w1:t2',
    terminalId: 'term_3',
    agentName: 'clawa-unique',
    session: '/tmp/herdr.sock',
    sessionFile: '/tmp/worker.jsonl',
  }
  assert.deepEqual(parsePanelHandle(herdr), herdr)
  const { agentName: _agentName, ...missingName } = herdr
  assert.throws(() => parsePanelHandle(missingName), INVALID_HANDLE)

  const tmux = {
    host: 'tmux',
    paneId: '%3',
    panePid: '313',
    serverPid: '21',
    socket: '/tmp/tmux/socket',
    sessionFile: '/tmp/worker.jsonl',
  }
  assert.deepEqual(parsePanelHandle(tmux), tmux)
  const { panePid: _panePid, ...missingPid } = tmux
  assert.throws(() => parsePanelHandle(missingPid), INVALID_HANDLE)
})
