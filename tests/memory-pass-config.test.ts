import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

async function writeConfig(root: string, clawa: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, '.pi'), { recursive: true })
  await writeFile(
    join(root, '.pi', 'claw.jsonc'),
    JSON.stringify({ clawas: { workers: [] }, clawa }),
    'utf8',
  )
}

test('retired context settings are inert even when malformed, without rewriting stored config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-memory-pass-config-'))
  try {
    await writeConfig(root, { humanName: 'Igor', controlPlaneDir: 'house-control' })
    const expected = loadClawEnvironmentConfig(root).config
    for (const legacy of [
      { contextManagement: 'local', memoryPass: { enabled: true, triggerPercent: 90 } },
      { contextManagement: 'pi', memoryPass: { enabled: false, triggerPercent: 100 } },
      { contextManagement: 'remote', memoryPass: { enabled: 'yes', triggerPercent: -1 } },
      { contextManagement: null, memoryPass: 'retired' },
    ]) {
      await writeConfig(root, { humanName: 'Igor', controlPlaneDir: 'house-control', ...legacy })
      const path = join(root, '.pi', 'claw.jsonc')
      const before = await readFile(path, 'utf8')
      assert.deepEqual(loadClawEnvironmentConfig(root).config, expected)
      assert.equal(await readFile(path, 'utf8'), before)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
