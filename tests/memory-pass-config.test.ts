import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

const INVALID_THRESHOLD_PATTERN =
  /clawa\.memoryPass\.triggerPercent must be an integer from 1 to 99/

async function writeConfig(root: string, clawa: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true })
  await writeFile(
    join(root, '.pi', 'claw.jsonc'),
    JSON.stringify({ clawas: { workers: [] }, clawa }),
    'utf8',
  )
}

test('legacy Clawa compaction settings no longer override Pi ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-pass-config-'))
  try {
    await writeConfig(root, {
      compaction: { auto: true, triggerPercent: 80, sidecarModel: 'provider/model' },
    })
    assert.deepEqual(loadClawEnvironmentConfig(root).config.clawa.memoryPass, {
      enabled: true,
      triggerPercent: 90,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('memory pass rejects thresholds outside one to ninety-nine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-pass-config-'))
  try {
    await writeConfig(root, { memoryPass: { enabled: true, triggerPercent: 100 } })
    assert.throws(() => loadClawEnvironmentConfig(root), INVALID_THRESHOLD_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
