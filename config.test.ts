import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ensureHowabouaClawConfig,
  getHowabouaClawConfigPath,
  isHowabouaClawEnvironmentBootstrapped,
  markHowabouaClawEnvironmentBootstrapped,
} from './config.js'

test('ensureHowabouaClawConfig creates project config with bootstrapped false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-config-'))
  try {
    const created = ensureHowabouaClawConfig(dir)
    assert.equal(created.created, true)
    assert.equal(created.path, getHowabouaClawConfigPath(dir))
    assert.equal(created.config.bootstrapped, false)
    assert.equal(isHowabouaClawEnvironmentBootstrapped(dir), false)

    const raw = await readFile(created.path, 'utf8')
    assert.match(raw, /"bootstrapped": false/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('markHowabouaClawEnvironmentBootstrapped flips bootstrapped true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawa-config-'))
  try {
    const marked = markHowabouaClawEnvironmentBootstrapped(dir)
    assert.equal(marked.config.bootstrapped, true)
    assert.equal(isHowabouaClawEnvironmentBootstrapped(dir), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
