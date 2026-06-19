import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ensureClawEnvironmentConfig,
  findRepoRoot,
  markClawEnvironmentBootstrapped,
} from './config.js'
import { copyTemplateFiles, findExistingTemplateFiles } from './template-files.js'

const MAIN_TEMPLATES_DIR = join(process.cwd(), 'templates', 'main')
const BOOTSTRAPPED_TRUE_PATTERN = /"bootstrapped": true/

test('first-run bootstrap sequence creates core files and marks config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-first-run-'))
  try {
    await mkdir(join(root, '.git'))

    const extensionConfig = ensureClawEnvironmentConfig(root)
    const conflicts = await findExistingTemplateFiles(MAIN_TEMPLATES_DIR, root)
    assert.deepEqual(conflicts, [])

    const copied = await copyTemplateFiles(MAIN_TEMPLATES_DIR, root)
    const marked = markClawEnvironmentBootstrapped(findRepoRoot(root))

    assert.equal(extensionConfig.created, true)
    assert.equal(extensionConfig.config.bootstrapped, false)
    assert.equal(marked.config.bootstrapped, true)
    assert.ok(copied.copied.includes('AGENTS.md'))
    assert.ok(copied.copied.includes('IDENTITY.md'))
    assert.match(await readFile(join(root, '.pi', 'claw.jsonc'), 'utf8'), BOOTSTRAPPED_TRUE_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('first-run bootstrap detects pre-existing core markdown files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-first-run-conflict-'))
  try {
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'AGENTS.md'), 'existing project rules', 'utf8')
    await writeFile(join(root, 'SOUL.md'), 'existing soul', 'utf8')

    const conflicts = await findExistingTemplateFiles(MAIN_TEMPLATES_DIR, root)

    assert.deepEqual(conflicts.sort(), ['AGENTS.md', 'SOUL.md'].sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
