import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ensureClawEnvironmentConfig,
  findRepoRoot,
  markClawEnvironmentBootstrapped,
} from './config.js'
import { markClawBootstrapped } from './state.js'
import { copyTemplateFiles } from './template-files.js'

const MAIN_TEMPLATES_DIR = join(process.cwd(), 'templates', 'main')

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

test('first-run bootstrap sequence preserves existing home files and marks config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-first-run-'))
  try {
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'AGENTS.md'), 'existing project rules', 'utf8')

    const extensionConfig = ensureClawEnvironmentConfig(root)
    const copied = await copyTemplateFiles(MAIN_TEMPLATES_DIR, root)
    await markClawBootstrapped(root)
    const marked = markClawEnvironmentBootstrapped(findRepoRoot(root))

    assert.equal(extensionConfig.created, true)
    assert.equal(extensionConfig.config.bootstrapped, false)
    assert.equal(marked.config.bootstrapped, true)
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'existing project rules')
    assert.ok(copied.skipped.includes('AGENTS.md'))
    assert.ok(copied.copied.includes('IDENTITY.md'))
    assert.ok(await exists(join(root, '.pi', 'claw-state.json')))
    assert.ok(await exists(join(root, '.pi', 'claw.jsonc')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
