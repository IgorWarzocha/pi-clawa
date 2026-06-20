import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  buildPiDefaultSystemPromptBase,
  CLAWA_PERSONAL_ASSISTANT_INTRO,
  replacePiDefaultAssistantIntro,
  resolveClawaPromptName,
  resolveClawaSystemPrompt,
} from './system-prompt.js'

const options = {
  cwd: '/repo',
  selectedTools: ['read'],
  toolSnippets: { read: 'read files' },
  promptGuidelines: ['Use read for text files'],
}

const piDefault = [
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.',
  '',
  'Available tools:',
  '- read: read files',
].join('\n')

test('replacePiDefaultAssistantIntro preserves Pi tool section', () => {
  const replaced = replacePiDefaultAssistantIntro(piDefault)

  assert.ok(replaced.startsWith(CLAWA_PERSONAL_ASSISTANT_INTRO))
  assert.ok(replaced.includes('\nAvailable tools:\n- read: read files'))
  assert.equal(replaced.includes('expert coding assistant operating inside pi'), false)
})

test('resolveClawaSystemPrompt ignores custom prompts and rebuilds Pi defaults', () => {
  const customPrompt = '# Custom prompt\n\nBe weird.'
  const suffix = '\n\n<project_context>keep me</project_context>\nCurrent date: 2026-06-19'
  const result = resolveClawaSystemPrompt(`${customPrompt}${suffix}`, {
    ...options,
    customPrompt,
  })

  assert.equal(result.ignoredCustomPrompt, true)
  assert.ok(result.systemPrompt.startsWith(CLAWA_PERSONAL_ASSISTANT_INTRO))
  assert.ok(result.systemPrompt.includes('\nAvailable tools:\n- read: read files'))
  assert.ok(result.systemPrompt.includes('- Use read for text files'))
  assert.ok(result.systemPrompt.endsWith(suffix))
  assert.equal(result.systemPrompt.includes('Be weird.'), false)
})

test('buildPiDefaultSystemPromptBase matches Pi default structure', () => {
  const prompt = buildPiDefaultSystemPromptBase(options, {
    readmePath: '/pi/README.md',
    docsPath: '/pi/docs',
    examplesPath: '/pi/examples',
  })

  assert.ok(prompt.startsWith('You are an expert coding assistant operating inside pi'))
  assert.ok(prompt.includes('\nAvailable tools:\n- read: read files'))
  assert.ok(prompt.includes('\nGuidelines:\n- Use read for text files'))
  assert.ok(prompt.includes('- Main documentation: /pi/README.md'))
})

test('resolveClawaPromptName uses project and worker JSON names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-prompt-name-'))
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(join(root, 'clawas', 'gremlin-clawa'), { recursive: true })
    await writeFile(
      join(root, '.pi', 'claw.jsonc'),
      JSON.stringify({
        bootstrapped: true,
        clawas: {
          baseDir: 'clawas',
          tmuxSession: 'clawas',
          workers: [{ id: 'gremlin-clawa', title: 'Gremlin Clawa', cwd: 'clawas/gremlin-clawa' }],
        },
        clawa: { mainClawName: 'Howaclawa' },
      }),
      'utf8',
    )

    assert.equal(resolveClawaPromptName(root), 'Howaclawa')
    assert.equal(resolveClawaPromptName(join(root, 'clawas', 'gremlin-clawa')), 'Gremlin Clawa')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
