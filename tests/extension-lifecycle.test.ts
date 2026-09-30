import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { getClawasSessionStatus } from '../src/clawas/comms/client.js'
import { resolveActiveHome } from '../src/extension/activation.js'
import { bootstrapMainHome } from '../src/extension/bootstrap-actions.js'
import { ClawaRuntimeState } from '../src/extension/runtime-state.js'

const packageRoot = resolve(import.meta.dirname, '..')
const environmentKeys = [
  'PI_CLAW_PROJECT_ROOT',
  'PI_CLAW_EXTENSION_PATH',
  'PI_CLAWAS_CONTROL_SOCKET_ROOT',
  'PI_CLAWAS_CONTROL_SOCKET_DIR',
  'XDG_RUNTIME_DIR',
] as const

async function withClawa(
  scope: 'user' | 'temporary',
  existingHome: boolean,
  run: (
    session: Awaited<ReturnType<typeof createAgentSession>>['session'],
    cwd: string,
    startup: { errors: string[]; initialEntries: ReturnType<SessionManager['getEntries']> },
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'clawa-'))
  const cwd = join(root, 'home')
  const agentDir = join(root, 'agent')
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]))
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
  try {
    for (const key of environmentKeys) delete process.env[key]
    process.env['XDG_RUNTIME_DIR'] = root
    await mkdir(cwd)
    await mkdir(agentDir)
    if (existingHome) await bootstrapMainHome(cwd, new ClawaRuntimeState())
    const settingsManager = SettingsManager.inMemory(
      scope === 'user' ? { packages: [packageRoot] } : {},
    )
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      additionalExtensionPaths: scope === 'temporary' ? [join(packageRoot, 'src', 'index.ts')] : [],
    })
    await resourceLoader.reload()
    const errors = resourceLoader.getExtensions().errors.map((error) => error.error)
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(agentDir, 'models-store.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    session = (
      await createAgentSession({
        cwd,
        agentDir,
        settingsManager,
        resourceLoader,
        modelRuntime,
        sessionManager: SessionManager.inMemory(cwd),
      })
    ).session
    const initialEntries = session.sessionManager.getEntries()
    await session.bindExtensions({ onError: (error) => errors.push(error.error) })
    await run(session, cwd, { errors, initialEntries })
  } finally {
    if (session) await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    session?.dispose()
    for (const key of environmentKeys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
}

test('global installation is inert outside a home', async () => {
  await withClawa('user', false, async (session, cwd, { errors, initialEntries }) => {
    assert.deepEqual(session.sessionManager.getEntries(), initialEntries)
    assert.equal(await getClawasSessionStatus(session.sessionManager.getSessionId()), null)
    assert.equal(existsSync(join(cwd, '.pi')), false)
    assert.equal(process.env['PI_CLAW_EXTENSION_PATH'], undefined)
    assert.equal(
      session
        .getActiveToolNames()
        .some((name) => name.startsWith('clawa_') || name === 'message_clawa'),
      false,
    )
    const result = await session.extensionRunner.emitBeforeAgentStart('hello', undefined, {
      cwd,
      sections: { other: 'KEEP' },
    })
    assert.deepEqual(result.systemPromptOptions.sections, { other: 'KEEP' })
    assert.deepEqual(
      (await session.extensionRunner.emitResourcesDiscover(cwd, 'startup')).skillPaths,
      [],
    )
    assert.equal(existsSync(join(cwd, '.pi')), false)
    assert.deepEqual(errors, [])
  })
})

test('explicit loading bootstraps without starting a turn or claiming Pi continuity', async () => {
  await withClawa('temporary', false, async (session, cwd, { errors, initialEntries }) => {
    // Shepherdr binds after startup, before its first task. Even a new home stays fresh.
    const status = await getClawasSessionStatus(session.sessionManager.getSessionId())
    assert.equal(status?.sessionId, session.sessionManager.getSessionId())
    assert.equal(status?.isIdle, true)
    assert.deepEqual(session.sessionManager.getEntries(), initialEntries)
    assert.equal(
      JSON.parse(await readFile(join(cwd, '.pi', 'claw.jsonc'), 'utf8')).bootstrapped,
      true,
    )
    assert.ok(existsSync(join(cwd, 'CLAW.md')))
    const names = session.getActiveToolNames()
    assert.ok(names.includes('clawa_memory'))
    assert.ok(names.includes('clawa_history'))
    for (const name of ['notes', 'history', 'new_context', 'get_context_remaining'])
      assert.equal(names.includes(name), false)
    assert.equal(session.autoCompactionEnabled, true)
    assert.deepEqual(errors, [])
  })
})

test('an existing globally installed home hydrates on prepared turns, not startup', async () => {
  await withClawa('user', true, async (session, cwd, { errors, initialEntries }) => {
    assert.deepEqual(session.sessionManager.getEntries(), initialEntries)
    await writeFile(join(cwd, 'CLAW.md'), 'FIRST_HOME_STATE')
    const first = await session.extensionRunner.emitBeforeAgentStart('hello', undefined, {
      cwd,
      sections: { continuity_owner: 'KEEP' },
    })
    assert.ok(first.systemPromptOptions.sections['clawa_home']?.includes('FIRST_HOME_STATE'))
    await writeFile(join(cwd, 'CLAW.md'), 'UPDATED_HOME_STATE')
    const next = await session.extensionRunner.emitBeforeAgentStart('Continue.', undefined, {
      cwd,
      sections: { continuity_owner: 'KEEP' },
    })
    assert.ok(next.systemPromptOptions.sections['clawa_home']?.includes('UPDATED_HOME_STATE'))
    assert.equal(
      next.systemPromptOptions.sections['clawa_home']?.includes('FIRST_HOME_STATE'),
      false,
    )
    assert.equal(next.systemPromptOptions.sections['continuity_owner'], 'KEEP')
    assert.equal(next.systemPromptOptions.forceSystemPrompt, undefined)
    assert.deepEqual(errors, [])
  })
})

test('stale inherited home variables do not activate unrelated projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-activation-'))
  try {
    const home = join(root, 'home')
    const outside = join(root, 'outside')
    await mkdir(home)
    await mkdir(outside)
    await bootstrapMainHome(home, new ClawaRuntimeState())
    assert.equal(resolveActiveHome(outside, 'user', home), undefined)
    assert.equal(resolveActiveHome(home, 'user', home), home)
    assert.equal(resolveActiveHome(outside, 'project', home), outside)
    const worker = join(home, 'clawas', 'worker')
    await mkdir(join(worker, '.pi'), { recursive: true })
    await writeFile(join(worker, '.pi', 'settings.json'), '{}')
    assert.equal(resolveActiveHome(worker, 'user', ''), home)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
