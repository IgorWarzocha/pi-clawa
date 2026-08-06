import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawasConfig } from '../src/clawas/config-loader.js'
import { loadClawEnvironmentConfig } from '../src/config.js'

const DUPLICATE_WORKER_PATTERN = /Duplicate Clawas worker id: techie/u
const INVALID_WORKER_BOOLEAN_PATTERN = /clawas\.workers\[0\]\.enabled must be a boolean/u

test('setup and runtime derive workers from one normalized config contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-config-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: {
          workers: [
            { id: ' techie ', title: ' Techie ', cwd: ' clawas/techie ' },
            { id: 'sleeping', title: 'Sleeping', cwd: 'clawas/sleeping', enabled: false },
          ],
        },
        clawa: {},
      }),
      'utf8',
    )

    const environmentWorker = loadClawEnvironmentConfig(root).config.clawas.workers[0]
    const runtimeWorker = (await loadClawasConfig(root))?.workers[0]
    assert.deepEqual(environmentWorker, runtimeWorker)
    assert.deepEqual(runtimeWorker, {
      id: 'techie',
      title: 'Techie',
      emoji: undefined,
      cwd: 'clawas/techie',
      discordEnabled: false,
      extensions: undefined,
      enabled: true,
      autostart: true,
      startupPrompt: undefined,
      model: undefined,
      thinking: undefined,
      reportMode: undefined,
    })
    assert.equal((await loadClawasConfig(root))?.workers.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('duplicate worker ids fail at the shared config boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-config-duplicate-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        clawas: {
          workers: [
            { id: 'Techie', cwd: 'clawas/one' },
            { id: 'techie', cwd: 'clawas/two' },
          ],
        },
        clawa: {},
      }),
      'utf8',
    )
    assert.throws(() => loadClawEnvironmentConfig(root), DUPLICATE_WORKER_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('malformed worker options fail instead of silently changing runtime behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-config-invalid-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        clawas: { workers: [{ id: 'techie', cwd: 'clawas/techie', enabled: 'false' }] },
        clawa: {},
      }),
      'utf8',
    )
    assert.throws(() => loadClawEnvironmentConfig(root), INVALID_WORKER_BOOLEAN_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
