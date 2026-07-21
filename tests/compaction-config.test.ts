import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

const INVALID_TRIGGER_PERCENT_REGEX =
  /clawa\.compaction\.triggerPercent must be an integer from 1 to 99/

async function writeConfig(root: string, compaction: unknown): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true })
  await writeFile(
    join(root, '.pi', 'claw.jsonc'),
    JSON.stringify({
      bootstrapped: true,
      clawas: { baseDir: 'clawas', tmuxSession: 'clawas', workers: [] },
      clawa: { compaction },
    }),
  )
}

test('Clawa compaction defaults to an 80% settled threshold', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-'))
  try {
    await writeConfig(root, undefined)
    assert.deepEqual(loadClawEnvironmentConfig(root).config.clawa.compaction, {
      auto: true,
      triggerPercent: 80,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('malformed Clawa compaction thresholds fail visibly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-'))
  try {
    await writeConfig(root, { auto: true, triggerPercent: 130 })
    assert.throws(() => loadClawEnvironmentConfig(root), INVALID_TRIGGER_PERCENT_REGEX)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
