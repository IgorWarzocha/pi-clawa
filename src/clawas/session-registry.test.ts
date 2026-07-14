import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { getClawaSessionsDir, resolveWorkerSessionFile } from './session-registry.js'
import type { WorkerDefinition } from './types.js'

const SESSION_REGISTRY_NAME = 'session-registry.json'
const SESSION_FILE_SUFFIX_REGEX = /\.jsonl$/
const JSON_ERROR_PATTERN = /JSON/

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

test('worker session continuity survives model and thinking changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-worker-model-change-'))
  try {
    const workerHome = join(root, 'clawas', 'discord-clawa')
    const controlPlaneRoot = join(root, '.pi', 'clawas')
    await mkdir(workerHome, { recursive: true })

    const original = workerDefinition('discord-clawa')
    const sessionFile = await resolveWorkerSessionFile(controlPlaneRoot, original, workerHome)
    await writeFile(
      sessionFile,
      `${JSON.stringify({ type: 'session', version: 3, cwd: workerHome })}\n`,
      'utf8',
    )
    const changed = {
      ...original,
      model: 'another-provider/new-model',
      thinking: 'low' as const,
    }
    const resumedFile = await resolveWorkerSessionFile(controlPlaneRoot, changed, workerHome)

    assert.equal(resumedFile, sessionFile)
    const registry = JSON.parse(
      await readFile(join(controlPlaneRoot, SESSION_REGISTRY_NAME), 'utf8'),
    ) as { workers: Record<string, { path: string; model?: string; thinking?: string }> }
    assert.deepEqual(registry.workers['discord-clawa'], {
      path: sessionFile,
      model: changed.model,
      thinking: changed.thinking,
      cwd: workerHome,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
