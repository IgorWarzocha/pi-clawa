import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ensureClawEnvironmentConfig,
  getClawEnvironmentConfigPath,
  isClawEnvironmentBootstrapped,
  markClawEnvironmentBootstrapped,
} from './config.js'

const BOOTSTRAPPED_FALSE_REGEX = /"bootstrapped": false/

test('ensureClawEnvironmentConfig creates project config with bootstrapped false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-config-'))
  try {
    const created = ensureClawEnvironmentConfig(dir)
    assert.equal(created.created, true)
    assert.equal(created.path, getClawEnvironmentConfigPath(dir))
    assert.equal(created.config.bootstrapped, false)
    assert.deepEqual(created.config.clawas.workers, [])
    assert.equal(isClawEnvironmentBootstrapped(dir), false)

    const raw = await readFile(created.path, 'utf8')
    assert.match(raw, BOOTSTRAPPED_FALSE_REGEX)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('markClawEnvironmentBootstrapped flips bootstrapped true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-config-'))
  try {
    const marked = markClawEnvironmentBootstrapped(dir)
    assert.equal(marked.config.bootstrapped, true)
    assert.equal(isClawEnvironmentBootstrapped(dir), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
