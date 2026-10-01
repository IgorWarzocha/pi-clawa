import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'

const DUPLICATE_WORKER_PATTERN = /Duplicate Clawas worker id: techie/u

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
