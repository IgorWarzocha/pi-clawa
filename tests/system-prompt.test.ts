import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import { registerClawaSystemPrompt } from '../src/system-prompt.js'

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
