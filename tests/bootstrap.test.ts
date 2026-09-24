import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig } from '../src/config.js'
import { bootstrapMainHome } from '../src/extension/bootstrap-actions.js'
import { ClawaRuntimeState } from '../src/extension/runtime-state.js'

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawa-bootstrap-'))
  await mkdir(join(root, '.git'))
  return root
}

test('existing core files block bootstrap without changing them or marking the home', async () => {
  const root = await home()
  try {
    await writeFile(join(root, 'HUMAN.md'), 'My human\n')
    const runtime = new ClawaRuntimeState()
    const result = await bootstrapMainHome(root, runtime)
    assert.deepEqual(result, { kind: 'blocked', conflicts: ['HUMAN.md'] })
    assert.equal(await readFile(join(root, 'HUMAN.md'), 'utf8'), 'My human\n')
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, false)
    assert.equal(runtime.bootstrapped, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('bootstrap preserves existing nested home files and commits the config before runtime state', async () => {
  const root = await home()
  try {
    await mkdir(join(root, 'vault'), { recursive: true })
    await writeFile(join(root, 'vault', 'index.md'), 'Keep this index\n')
    const runtime = new ClawaRuntimeState()
    const result = await bootstrapMainHome(root, runtime)
    assert.equal(result.kind, 'complete')
    if (result.kind !== 'complete') return
    assert.equal(result.copied.copied.includes('vault/index.md'), false)
    assert.equal(await readFile(join(root, 'vault', 'index.md'), 'utf8'), 'Keep this index\n')
    assert.ok((await readFile(join(root, 'CLAW.md'), 'utf8')).length > 0)
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, true)
    assert.equal(runtime.bootstrapped, true)
    assert.equal(runtime.extensionBootstrapped, true)
    assert.equal(runtime.hydrationStale, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed config persistence cannot mark in-memory bootstrap success', async () => {
  const root = await home()
  try {
    await mkdir(join(root, '.pi', 'claw.jsonc'), { recursive: true })
    const runtime = new ClawaRuntimeState()
    runtime.extensionBootstrapped = false
    await assert.rejects(bootstrapMainHome(root, runtime))
    assert.ok((await readFile(join(root, 'CLAW.md'), 'utf8')).length > 0)
    assert.equal(runtime.bootstrapped, false)
    assert.equal(runtime.extensionBootstrapped, false)
    assert.equal(runtime.hydrationStale, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed template copying preserves the obstruction and leaves bootstrap unmarked', async () => {
  const root = await home()
  try {
    await writeFile(join(root, 'pulses'), 'Keep this file\n')
    const runtime = new ClawaRuntimeState()
    await assert.rejects(bootstrapMainHome(root, runtime))
    assert.equal(await readFile(join(root, 'pulses'), 'utf8'), 'Keep this file\n')
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, false)
    assert.equal(runtime.bootstrapped, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a directory in place of a template file does not count as a copied home', async () => {
  const root = await home()
  try {
    await mkdir(join(root, 'vault', 'index.md'), { recursive: true })
    const runtime = new ClawaRuntimeState()
    await assert.rejects(bootstrapMainHome(root, runtime))
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, false)
    assert.equal(runtime.bootstrapped, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
