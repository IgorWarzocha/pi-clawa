import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

const SIDECAR_MODEL_ERROR = /clawa\.compaction\.sidecarModel must be a provider\/model-id string/

async function writeConfig(root: string, compaction: unknown): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true })
  await writeFile(
    join(root, '.pi', 'claw.jsonc'),
    JSON.stringify({ clawas: { workers: [] }, clawa: { compaction } }),
    'utf8',
  )
}

test('compaction sidecar model accepts a provider/model-id override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-'))
  try {
    await writeConfig(root, {
      auto: true,
      triggerPercent: 80,
      sidecarModel: 'openrouter/anthropic/claude-sonnet',
    })

    assert.equal(
      loadClawEnvironmentConfig(root).config.clawa.compaction.sidecarModel,
      'openrouter/anthropic/claude-sonnet',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compaction sidecar model rejects malformed refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-compaction-config-'))
  try {
    await writeConfig(root, { auto: true, triggerPercent: 80, sidecarModel: 'model-only' })
    assert.throws(() => loadClawEnvironmentConfig(root), SIDECAR_MODEL_ERROR)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
