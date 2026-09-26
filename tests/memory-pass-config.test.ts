import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

const INVALID_THRESHOLD_PATTERN =
  /clawa\.memoryPass\.triggerPercent must be an integer from 1 to 99/
const INVALID_MODE_PATTERN = /clawa\.contextManagement must be local or pi/

async function writeConfig(root: string, clawa: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true })
  await writeFile(
    join(root, '.pi', 'claw.jsonc'),
    JSON.stringify({ clawas: { workers: [] }, clawa }),
    'utf8',
  )
}

test('memory pass rejects thresholds outside one to ninety-nine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-pass-config-'))
  try {
    await writeConfig(root, { memoryPass: { enabled: true, triggerPercent: 100 } })
    assert.throws(() => loadClawEnvironmentConfig(root), INVALID_THRESHOLD_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local context is automatic unless the home explicitly selects Pi compaction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-context-mode-'))
  try {
    await writeConfig(root, {})
    assert.equal(loadClawEnvironmentConfig(root).config.clawa.contextManagement, 'local')
    await writeConfig(root, { contextManagement: 'pi' })
    assert.equal(loadClawEnvironmentConfig(root).config.clawa.contextManagement, 'pi')
    await writeConfig(root, { contextManagement: 'remote' })
    assert.throws(() => loadClawEnvironmentConfig(root), INVALID_MODE_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
