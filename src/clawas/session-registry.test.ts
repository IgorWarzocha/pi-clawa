import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  readWorkerSession,
  recordWorkerSession,
  resolveWorkerSessionFile,
} from './session-registry.js'
import type { WorkerDefinition } from './types.js'

const SESSION_REGISTRY_NAME = 'session-registry.json'
const JSON_ERROR_PATTERN = /JSON/
const PANEL_ERROR_PATTERN = /Invalid Clawas panel handle/u

function workerDefinition(id: string): WorkerDefinition {
  return {
    id,
    title: id,
    cwd: `clawas/${id}`,
    enabled: true,
    autostart: true,
    model: 'test/provider-model',
    thinking: 'medium',
  }
}

test('corrupt worker session registry fails instead of creating a fresh session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-worker-sessions-corrupt-'))
  try {
    const workerHome = join(root, 'clawas', 'discord-clawa')
    const controlPlaneRoot = join(root, '.pi', 'clawas')
    await mkdir(workerHome, { recursive: true })
    await mkdir(controlPlaneRoot, { recursive: true })
    await writeFile(join(controlPlaneRoot, SESSION_REGISTRY_NAME), '{ nope', 'utf8')

    await assert.rejects(
      () =>
        resolveWorkerSessionFile(controlPlaneRoot, workerDefinition('discord-clawa'), workerHome),
      JSON_ERROR_PATTERN,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent registry updates preserve every worker and its panel location', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-registry-concurrent-'))
  try {
    const panel = {
      host: 'tmux' as const,
      paneId: '%7',
      panePid: '100',
      serverPid: '10',
      socket: '/tmp/tmux',
      sessionFile: '/original.jsonl',
    }
    await Promise.all([
      recordWorkerSession(root, workerDefinition('alpha'), '/alpha', '/resumed.jsonl', panel),
      resolveWorkerSessionFile(root, workerDefinition('beta'), join(root, 'beta')),
    ])
    const alpha = await readWorkerSession(root, 'alpha')
    assert.equal(alpha?.path, '/resumed.jsonl')
    assert.deepEqual(alpha?.panel, panel)
    assert.equal((await readWorkerSession(root, 'beta'))?.cwd, join(root, 'beta'))
    assert.deepEqual(await resolveWorkerSessionFile(root, workerDefinition('alpha'), '/alpha'), {
      sessionFile: '/resumed.jsonl',
      kind: 'fresh',
    })
    assert.deepEqual((await readWorkerSession(root, 'alpha'))?.panel, panel)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid persisted panel identity fails without discarding the session record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-registry-panel-'))
  const original = JSON.stringify({
    workers: { alpha: { path: '/session.jsonl', panel: { host: 'tmux' } } },
  })
  try {
    const file = join(root, SESSION_REGISTRY_NAME)
    await writeFile(file, original)
    await assert.rejects(
      () => resolveWorkerSessionFile(root, workerDefinition('alpha'), root),
      PANEL_ERROR_PATTERN,
    )
    assert.equal(await readFile(file, 'utf8'), original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
