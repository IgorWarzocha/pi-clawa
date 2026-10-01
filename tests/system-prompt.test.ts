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
    let prompt = ''
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [
        (pi) => {
          registerClawaSystemPrompt(pi, () => true)
          pi.on('before_agent_start', (event) => {
            prompt = event.systemPrompt
          })
        },
      ],
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
      contextFiles: [outside, home],
      selectedTools: ['read'],
      toolSnippets: { read: 'READ_DESCRIPTION' },
      toolGuidelines: { read: ['READ_POLICY'] },
      appendSystemPrompt: 'APPENDED_INSTRUCTION',
      sections: { extra: 'EXTRA_SECTION' },
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(result.systemPromptOptions.contextFiles, [home])
    assert.equal(result.systemPromptOptions.forceSystemPrompt, undefined)
    assert.ok(prompt.includes('# Clawa personal assistant'))
    for (const value of [
      home.content,
      'READ_DESCRIPTION',
      'READ_POLICY',
      'APPENDED_INSTRUCTION',
      'EXTRA_SECTION',
    ]) {
      assert.ok(prompt.includes(value), value)
    }
    assert.equal(prompt.includes(outside.content), false)
    const overridden = await session.extensionRunner.emitBeforeAgentStart('hello', undefined, {
      cwd,
      forceSystemPrompt: 'EXTERNAL_PROMPT_OWNER',
    })
    assert.equal(overridden.systemPromptOptions.forceSystemPrompt, 'EXTERNAL_PROMPT_OWNER')
  } finally {
    session?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
