import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ensureClawEnvironmentConfig,
  findRepoRoot,
  markClawEnvironmentBootstrapped,
} from './config.js'
import { createNewClaw } from './extension/clawa-seed.js'
import { INITIAL_BOOTSTRAP_PROMPT } from './extension/onboarding.js'
import { copyTemplateFiles, findExistingCoreMarkdownFiles } from './template-files.js'

const MAIN_TEMPLATES_DIR = join(process.cwd(), 'templates', 'main')
const BOOTSTRAPPED_TRUE_PATTERN = /"bootstrapped": true/
const SEEDED_WORKER_PATTERN = /"id": "research-odd-local-tools-clawa"/
const SEEDED_PURPOSE_PATTERN = /Research odd local tools/
const BOOTSTRAP_WAKE_PATTERN = /where the hell am I/
const BOOTSTRAP_ONBOARDING_PATTERN = /feel like onboarding/
const BOOTSTRAP_NO_WALLS_PATTERN = /No walls of text/
const BOOTSTRAP_NO_FIRST_EDIT_PATTERN = /do not edit files yet/
const BOOTSTRAP_NO_INTAKE_FORM_PATTERN = /No giant intake form/
const BOOTSTRAP_ADAPTIVE_LANGUAGE_PATTERN = /Translate it into whatever language fits me/
const BOOTSTRAP_NO_DEFAULT_SUBCLAWAS_PATTERN = /no default subclawas/i
const BOOTSTRAP_RECALL_PATTERN = /Use recall before pretending/
const BOOTSTRAP_NO_FIRST_RECALL_PATTERN = /Do not call recall on this first turn/
const BOOTSTRAP_LEAVE_WORKSHEET_PATTERN = /Leave the worksheet itself behind/
const SHARED_HUMAN_LINK_TARGET = '../../HUMAN.md'
const SHARED_CLAWAS_LINK_TARGET = '../../CLAWAS.md'

test('first-run bootstrap sequence creates core files and marks config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-first-run-'))
  try {
    await mkdir(join(root, '.git'))

    const extensionConfig = ensureClawEnvironmentConfig(root)
    const conflicts = findExistingCoreMarkdownFiles(root)
    assert.deepEqual(conflicts, [])

    const copied = await copyTemplateFiles(MAIN_TEMPLATES_DIR, root)
    const marked = markClawEnvironmentBootstrapped(findRepoRoot(root))

    assert.equal(extensionConfig.created, true)
    assert.equal(extensionConfig.config.bootstrapped, false)
    assert.equal(marked.config.bootstrapped, true)
    assert.ok(copied.copied.includes('AGENTS.md'))
    assert.ok(copied.copied.includes('CLAW.md'))
    assert.ok(copied.copied.includes('CLAWAS.md'))
    assert.equal(copied.copied.includes('PRIVACY.md'), false)
    assert.match(await readFile(join(root, '.pi', 'claw.jsonc'), 'utf8'), BOOTSTRAPPED_TRUE_PATTERN)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('first-run bootstrap prompt is progressive and points at living docs', () => {
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_WAKE_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_ONBOARDING_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_NO_WALLS_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_NO_FIRST_EDIT_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_NO_INTAKE_FORM_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_ADAPTIVE_LANGUAGE_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_NO_DEFAULT_SUBCLAWAS_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_RECALL_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_NO_FIRST_RECALL_PATTERN)
  assert.match(INITIAL_BOOTSTRAP_PROMPT, BOOTSTRAP_LEAVE_WORKSHEET_PATTERN)
})

test('first-run bootstrap detects pre-existing core markdown files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-first-run-conflict-'))
  try {
    await mkdir(join(root, '.git'))
    await writeFile(join(root, 'AGENTS.md'), 'existing project rules', 'utf8')
    await writeFile(join(root, 'SOUL.md'), 'legacy soul', 'utf8')

    const conflicts = findExistingCoreMarkdownFiles(root)

    assert.deepEqual(conflicts.sort(), ['AGENTS.md', 'SOUL.md'].sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('create Clawa seeds a specialized worker home from purpose', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-create-seed-'))
  try {
    await mkdir(join(root, '.git'))
    await copyTemplateFiles(MAIN_TEMPLATES_DIR, root)
    markClawEnvironmentBootstrapped(root)

    const userMessages: string[] = []
    const dimNotes: string[] = []
    const pi = {
      sendMessage: (message: { content?: string }) => {
        if (message.content) dimNotes.push(message.content)
      },
      sendUserMessage: (message: string) => userMessages.push(message),
    }
    const ctx = { cwd: root, hasUI: false }

    const created = await createNewClaw(pi as never, ctx as never, {
      purpose: 'Research odd local tools',
    })

    assert.equal(created.name, 'research-odd-local-tools-clawa')
    assert.equal(created.path, join('clawas', 'research-odd-local-tools-clawa'))
    assert.match(
      await readFile(join(root, '.pi', 'clawas', 'config.jsonc'), 'utf8'),
      SEEDED_WORKER_PATTERN,
    )
    assert.equal(await readlink(join(root, created.path, 'HUMAN.md')), SHARED_HUMAN_LINK_TARGET)
    assert.equal(await readlink(join(root, created.path, 'CLAWAS.md')), SHARED_CLAWAS_LINK_TARGET)
    assert.match(await readFile(join(root, 'CLAWAS.md'), 'utf8'), SEEDED_PURPOSE_PATTERN)
    assert.ok(userMessages.some((message) => message.includes('new specialized Clawa seed')))
    assert.ok(dimNotes.some((message) => message.includes('new Clawa seed created')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
