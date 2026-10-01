import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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
  await withClawa('user', async (session, cwd, { errors, initialEntries }) => {
    assert.deepEqual(session.sessionManager.getEntries(), initialEntries)
    assert.equal(await getClawasSessionStatus(session.sessionManager.getSessionId()), null)
    assert.equal(existsSync(join(cwd, '.pi')), false)
    assert.equal(process.env['PI_CLAW_EXTENSION_PATH'], undefined)
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
  await withClawa('temporary', async (session, cwd, { errors, initialEntries }) => {
    const status = await getClawasSessionStatus(session.sessionManager.getSessionId())
    assert.equal(status?.sessionId, session.sessionManager.getSessionId())
    assert.equal(status?.isIdle, true)
    assert.deepEqual(session.sessionManager.getEntries(), initialEntries)
    assert.equal(
      JSON.parse(await readFile(join(cwd, '.pi', 'claw.jsonc'), 'utf8')).bootstrapped,
      true,
    )
    assert.ok(existsSync(join(cwd, 'CLAW.md')))
    assert.equal(session.autoCompactionEnabled, true)
    assert.deepEqual(errors, [])
  })
})
