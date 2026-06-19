import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { getClawaSessionsDir, resolveWorkerSessionFile } from './session-registry.js'
import type { WorkerDefinition } from './types.js'

const SESSION_REGISTRY_NAME = 'session-registry.json'
const SESSION_FILE_SUFFIX_REGEX = /\.jsonl$/

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

test('worker sessions live under worker homes while the registry stays in the root control plane', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-worker-sessions-'))
  try {
    const workerHome = join(root, 'clawas', 'discord-clawa')
    const controlPlaneRoot = join(root, '.pi', 'clawas')
    await mkdir(workerHome, { recursive: true })

    const sessionFile = await resolveWorkerSessionFile(
      controlPlaneRoot,
      workerDefinition('discord-clawa'),
      workerHome,
    )

    assert.equal(dirname(sessionFile), getClawaSessionsDir(workerHome))
    assert.match(sessionFile, SESSION_FILE_SUFFIX_REGEX)

    const registry = JSON.parse(
      await readFile(join(controlPlaneRoot, SESSION_REGISTRY_NAME), 'utf8'),
    ) as { workers: Record<string, { path: string; cwd: string }> }
    assert.equal(registry.workers['discord-clawa']?.path, sessionFile)
    assert.equal(registry.workers['discord-clawa']?.cwd, workerHome)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
