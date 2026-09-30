import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClawEnvironmentConfig, resolveClawaDefaults } from '../src/config.js'
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
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(join(root, 'memory', 'index.md'), 'Keep this index\n')
    const runtime = new ClawaRuntimeState()
    const result = await bootstrapMainHome(root, runtime)
    assert.equal(result.kind, 'complete')
    if (result.kind !== 'complete') return
    assert.equal(result.copied.copied.includes('memory/index.md'), false)
    assert.equal(await readFile(join(root, 'memory', 'index.md'), 'utf8'), 'Keep this index\n')
    assert.ok((await readFile(join(root, 'CLAW.md'), 'utf8')).length > 0)
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, true)
    assert.equal(runtime.bootstrapped, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a pre-bootstrap vault moves before starter memory pages can shadow it', async () => {
  const root = await home()
  try {
    await mkdir(join(root, 'vault'))
    await writeFile(join(root, 'vault', 'index.md'), 'My existing front door\n')
    const result = await bootstrapMainHome(root, new ClawaRuntimeState())
    assert.equal(result.kind, 'complete')
    assert.equal(
      await readFile(join(root, 'memory', 'index.md'), 'utf8'),
      'My existing front door\n',
    )
    await assert.rejects(readFile(join(root, 'vault', 'index.md')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed config persistence cannot mark in-memory bootstrap success', async () => {
  const root = await home()
  try {
    await mkdir(join(root, '.pi', 'claw.jsonc'), { recursive: true })
    const runtime = new ClawaRuntimeState()
    await assert.rejects(bootstrapMainHome(root, runtime))
    assert.ok((await readFile(join(root, 'CLAW.md'), 'utf8')).length > 0)
    assert.equal(runtime.bootstrapped, false)
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
    await mkdir(join(root, 'memory', 'index.md'), { recursive: true })
    const runtime = new ClawaRuntimeState()
    await assert.rejects(bootstrapMainHome(root, runtime))
    assert.equal(loadClawEnvironmentConfig(root).config.bootstrapped, false)
    assert.equal(runtime.bootstrapped, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('worker-local Pi settings do not hide shared home readiness or defaults', async () => {
  const root = await home()
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    const worker = join(root, 'clawas', 'helper')
    await mkdir(join(worker, '.pi'), { recursive: true })
    await mkdir(join(root, '.pi'))
    await writeFile(join(worker, '.pi', 'settings.json'), '{}')
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: { workers: [] },
        clawa: { humanName: 'Igor', contextManagement: 'pi' },
      }),
    )
    process.env['PI_CLAW_PROJECT_ROOT'] = root
    assert.equal(new ClawaRuntimeState().ensureBootstrapped(worker), true)
    assert.equal(resolveClawaDefaults(worker).humanName, 'Igor')
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(root, { recursive: true, force: true })
  }
})
