import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { filterClawaHomeContextFiles, registerClawaSystemPrompt } from '../src/system-prompt.js'

test('Clawa context excludes global and parent instructions outside its home', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'clawa-contained-context-'))
  const root = join(parent, 'home')
  const worker = join(root, 'clawas', 'worker')
  const previousRoot = process.env['PI_CLAW_PROJECT_ROOT']
  try {
    await mkdir(join(root, '.pi'), { recursive: true })
    await mkdir(worker, { recursive: true })
    await writeFile(join(root, '.pi', 'settings.json'), '{}', 'utf8')
    const globalFile = { path: join(parent, 'global', 'AGENTS.MD'), content: 'GLOBAL' }
    const parentFile = { path: join(parent, 'AGENTS.md'), content: 'PARENT' }
    const rootFile = { path: join(root, 'AGENTS.md'), content: 'HOME' }
    const workerFile = { path: join(worker, 'AGENTS.md'), content: 'WORKER' }
    const contextFiles = [globalFile, parentFile, rootFile, workerFile]
    await mkdir(join(parent, 'global'), { recursive: true })
    for (const file of contextFiles) await writeFile(file.path, file.content, 'utf8')
    process.env['PI_CLAW_PROJECT_ROOT'] = root

    assert.deepEqual(filterClawaHomeContextFiles(contextFiles, worker), [rootFile, workerFile])
  } finally {
    if (previousRoot === undefined) delete process.env['PI_CLAW_PROJECT_ROOT']
    else process.env['PI_CLAW_PROJECT_ROOT'] = previousRoot
    await rm(parent, { recursive: true, force: true })
  }
})

test('global agent context stays excluded when its directory is inside the home', async () => {
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

test('native Pi prompt shaping isolates home context without losing tool policies or sections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-native-prompt-'))
  const cwd = join(root, 'home')
  const agentDir = join(root, 'agent')
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
  try {
    await mkdir(join(cwd, '.pi'), { recursive: true })
    await mkdir(agentDir)
    await writeFile(join(cwd, '.pi', 'settings.json'), '{}')
    const home = { path: join(cwd, 'AGENTS.md'), content: 'HOME_ONLY </project_context> text' }
    const outside = { path: join(root, 'AGENTS.md'), content: 'OUTSIDE_CONTEXT' }
    for (const file of [home, outside]) await writeFile(file.path, file.content)

    const settingsManager = SettingsManager.inMemory()
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [registerClawaSystemPrompt],
    })
    await resourceLoader.reload()
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(agentDir, 'models-store.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const created = await createAgentSession({
      cwd,
      agentDir,
      settingsManager,
      resourceLoader,
      modelRuntime,
      sessionManager: SessionManager.inMemory(cwd),
    })
    session = created.session
    const errors: string[] = []
    session.extensionRunner.onError((error) => errors.push(error.error))
    // Exercise Pi's real mutable-options getter, without credentials or a model request.
    const result = await session.extensionRunner.emitBeforeAgentStart('hello', undefined, {
      cwd,
      customPrompt: 'IGNORED_CUSTOM_PROMPT',
      forceSystemPrompt: 'OPAQUE_OVERRIDE OUTSIDE_CONTEXT',
      contextFiles: [outside, home],
      selectedTools: ['read'],
      toolSnippets: { read: 'READ_DESCRIPTION' },
      toolGuidelines: { read: ['READ_POLICY'] },
      appendSystemPrompt: 'APPENDED_INSTRUCTION',
      sections: { extra: 'EXTRA_SECTION' },
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(result.systemPromptOptions.contextFiles, [home])
    const prompt = result.systemPromptOptions.forceSystemPrompt
    assert.ok(prompt)
    assert.ok(prompt.startsWith('# Clawa personal assistant'))
    for (const value of [
      home.content,
      'READ_DESCRIPTION',
      'READ_POLICY',
      'APPENDED_INSTRUCTION',
      'EXTRA_SECTION',
    ]) {
      assert.ok(prompt.includes(value), value)
    }
    for (const value of ['IGNORED_CUSTOM_PROMPT', 'OPAQUE_OVERRIDE', outside.content]) {
      assert.equal(prompt.includes(value), false, value)
    }
  } finally {
    session?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
