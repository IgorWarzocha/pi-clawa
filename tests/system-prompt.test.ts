import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  CLAWA_PERSONAL_ASSISTANT_INTRO,
  filterClawaHomeContextFiles,
  registerClawaSystemPrompt,
  replacePiDefaultAssistantIntro,
  resolveClawaPromptName,
  resolveClawaSystemPrompt,
} from '../src/system-prompt.js'

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

const GLOBAL_SPINE_PATTERN = /GLOBAL SPINE/u
const PARENT_SPINE_PATTERN = /PARENT SPINE/u
const HOME_SPINE_PATTERN = /HOME SPINE/u
const WORKER_LANE_PATTERN = /WORKER LANE/u

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

test('Clawa keeps AGENTS context inside its own home and drops global and parent context', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-contained-context-'))
  const root = join(parent, 'home')
  const worker = join(root, 'clawas', 'worker')
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(worker, { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const globalFile = { path: join(parent, 'global', 'AGENTS.MD'), content: 'GLOBAL SPINE' }
    const parentFile = { path: join(parent, 'AGENTS.md'), content: 'PARENT SPINE' }
    const rootFile = { path: join(root, 'AGENTS.md'), content: 'HOME SPINE' }
    const workerFile = { path: join(worker, 'AGENTS.md'), content: 'WORKER LANE' }
    const contextFiles = [globalFile, parentFile, rootFile, workerFile]
    await mkdir(join(parent, 'global'), { recursive: true })
    for (const file of contextFiles) await writeFile(file.path, file.content, 'utf8')
    process.env['PI_CLAW_PROJECT_ROOT'] = root

    assert.deepEqual(filterClawaHomeContextFiles(contextFiles, worker), [rootFile, workerFile])

    const projectContext = [
      '<project_context>',
      '',
      'Project-specific instructions and guidelines:',
      '',
      ...contextFiles.map(
        (file) =>
          `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n`,
      ),
      '</project_context>',
    ].join('\n')
    const reformattedContext = projectContext.replace(
      'GLOBAL SPINE',
      'GLOBAL REFORMATTED BY PRIOR EXTENSION',
    )
    const result = resolveClawaSystemPrompt(`${piDefault}\n\n${reformattedContext}\n`, {
      ...options,
      cwd: worker,
      contextFiles,
    })

    assert.doesNotMatch(result.systemPrompt, GLOBAL_SPINE_PATTERN)
    assert.doesNotMatch(result.systemPrompt, PARENT_SPINE_PATTERN)
    assert.match(result.systemPrompt, HOME_SPINE_PATTERN)
    assert.match(result.systemPrompt, WORKER_LANE_PATTERN)
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(parent, { recursive: true, force: true })
  }
})

test('global agent context stays excluded even when the Clawa home contains the agent dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-global-agent-dir-'))
  try {
    const globalAgentDir = join(root, '.pi', 'agent')
    await mkdir(globalAgentDir, { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const homeFile = { path: join(root, 'AGENTS.md'), content: 'HOME' }
    const globalFile = { path: join(globalAgentDir, 'AGENTS.MD'), content: 'GLOBAL' }
    await writeFile(homeFile.path, homeFile.content, 'utf8')
    await writeFile(globalFile.path, globalFile.content, 'utf8')

    assert.deepEqual(filterClawaHomeContextFiles([globalFile, homeFile], root, globalAgentDir), [
      homeFile,
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing and dangling context paths fail closed', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-dangling-context-'))
  const root = join(parent, 'home')
  const outside = join(parent, 'outside-AGENTS.md')
  const linked = join(root, 'linked-AGENTS.md')
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    await writeFile(outside, 'OUTSIDE', 'utf8')
    await symlink(outside, linked)
    await rm(outside)

    assert.deepEqual(
      filterClawaHomeContextFiles(
        [
          { path: linked, content: 'OUTSIDE' },
          { path: join(root, 'missing-AGENTS.md'), content: 'MISSING' },
        ],
        root,
      ),
      [],
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('registered prompt filtering remains effective across turns without mutating Pi options', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-context-turns-'))
  const root = join(parent, 'home')
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const globalFile = { path: join(parent, 'AGENTS.MD'), content: 'GLOBAL SPINE' }
    const homeFile = { path: join(root, 'AGENTS.md'), content: 'HOME SPINE' }
    await writeFile(globalFile.path, globalFile.content, 'utf8')
    await writeFile(homeFile.path, homeFile.content, 'utf8')
    const contextFiles = [globalFile, homeFile]
    const projectContext = [
      '<project_context>',
      '',
      'Project-specific instructions and guidelines:',
      '',
      ...contextFiles.map(
        (file) =>
          `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n`,
      ),
      '</project_context>',
    ].join('\n')
    const systemPromptOptions = { ...options, cwd: root, contextFiles }
    const handlers = new Map<string, (event: never) => { systemPrompt?: string } | undefined>()
    registerClawaSystemPrompt({
      on: (name: string, handler: (event: never) => { systemPrompt?: string } | undefined) => {
        handlers.set(name, handler)
      },
      sendMessage: () => undefined,
    } as never)
    const beforeAgentStart = handlers.get('before_agent_start')
    assert.ok(beforeAgentStart)

    for (let turn = 0; turn < 2; turn += 1) {
      const result = beforeAgentStart({
        systemPrompt: `${piDefault}\n\n${projectContext}\n`,
        systemPromptOptions,
      } as never)
      assert.doesNotMatch(result?.systemPrompt ?? '', GLOBAL_SPINE_PATTERN)
      assert.match(result?.systemPrompt ?? '', HOME_SPINE_PATTERN)
    }
    assert.equal(systemPromptOptions.contextFiles, contextFiles)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
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
