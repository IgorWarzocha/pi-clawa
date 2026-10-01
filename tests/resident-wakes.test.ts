import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { getClawasSessionStatus, sendClawasSessionMessage } from '../src/clawas/comms/client.js'
import { ClawasCommsServer } from '../src/clawas/comms/server.js'
import { ClawasRuntime } from '../src/clawas/runtime.js'
import { ClawaContextSharing } from '../src/clawas/shared-context.js'
import { registerHydrationContext } from '../src/extension/hydration-context.js'
import { ClawaRuntimeState } from '../src/extension/runtime-state.js'
import { registerClawaSessionEvents } from '../src/extension/session-events.js'
import { registerPulseCommand } from '../src/pulses/command.js'
import { PulseRuntime } from '../src/pulses/runtime.js'
import { readPulseState } from '../src/pulses/state.js'
import { registerClawaSystemPrompt } from '../src/system-prompt.js'

const NO_MODEL = /No model selected/u
const NO_AUTH = /No authentication available/u
const environmentKeys = [
  'PI_CODING_AGENT_DIR',
  'PI_CLAW_PROJECT_ROOT',
  'PI_CLAW_EXTENSION_PATH',
  'PI_CLAWAS_CONTROL_SOCKET_ROOT',
  'PI_CLAWAS_CONTROL_SOCKET_DIR',
] as const

// Real SDK lifecycle and socket delivery; the public request hook stops before any provider IO.
async function resident(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'clawa-wake-'))
  const cwd = join(root, 'home')
  const agentDir = join(root, 'agent')
  const oldEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))
  let session: AgentSession | undefined
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    if (session) {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      session.dispose()
    }
    for (const [key, value] of oldEnvironment) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
  t.after(close)
  process.env['PI_CODING_AGENT_DIR'] = agentDir
  await mkdir(join(cwd, '.pi'), { recursive: true })
  await mkdir(join(cwd, '.git'))
  await mkdir(agentDir)
  await writeFile(
    join(cwd, '.pi', 'claw.jsonc'),
    JSON.stringify({ bootstrapped: true, clawa: {}, clawas: { workers: [] } }),
  )
  await writeFile(join(cwd, 'CLAW.md'), 'WAKE_HOME_IDENTITY')
  await mkdir(join(cwd, 'pulses', 'check'), { recursive: true })
  await writeFile(
    join(cwd, 'pulses', 'check', 'PULSE.md'),
    '---\ntitle: Check\nschedule: every 1m\n---\nCheck the home.',
  )
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(agentDir, 'models-store.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  const baseModel = modelRuntime.getModel('openai', 'gpt-4.1')
  if (!baseModel) throw new Error('Pi static model catalog is unavailable')
  const model = { ...baseModel, provider: 'clawa-offline-test' }
  modelRuntime.registerProvider(model.provider, {
    api: model.api,
    baseUrl: 'http://127.0.0.1:1',
    models: [model],
  })
  const runtime = new ClawaRuntimeState()
  const workers = new ClawasRuntime()
  let pulses!: PulseRuntime
  const errors: string[] = []
  const prepared: string[] = []
  let finishTurn = () => {}
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        const sharedContext = new ClawaContextSharing(pi, () => runtime.active)
        const server = new ClawasCommsServer(pi, () => undefined)
        pulses = new PulseRuntime(
          (ctx, message, isCurrent) => server.sendWake(ctx, message, isCurrent),
          workers,
        )
        const options = {
          runtime,
          clawasRuntime: workers,
          pulseRuntime: pulses,
          commsServer: server,
          sharedContext,
          setDefaults() {},
        }
        const prepare = registerClawaSessionEvents(pi, options)
        registerClawaSystemPrompt(pi, () => runtime.active)
        registerHydrationContext(pi, runtime)
        registerPulseCommand(pi, { ...options, prepare })
        pi.on('before_agent_start', (event) => {
          prepared.push(event.systemPrompt)
        })
        pi.on('agent_settled', () => finishTurn())
      },
    ],
  })
  await resourceLoader.reload()
  const loadErrors = resourceLoader.getExtensions().errors
  if (loadErrors.length > 0) throw new Error(JSON.stringify(loadErrors))
  const created = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader,
    modelRuntime,
    model,
    sessionManager: SessionManager.inMemory(cwd),
  })
  session = created.session
  session.agent.prepareRequest = async () => {
    throw new Error('Stopped at offline request boundary')
  }
  await session.bindExtensions({ onError: (error) => errors.push(error.error) })
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return {
    session,
    workers,
    pulses,
    prepared,
    errors,
    authenticate: () => modelRuntime.setRuntimeApiKey(model.provider, 'offline-test-only'),
    turn: () =>
      new Promise<void>((resolve) => {
        finishTurn = resolve
      }),
    close,
  }
}

test('missing model/auth reject socket tasks without latching later native SDK kickoffs', {
  timeout: 10_000,
}, async (t) => {
  const home = await resident(t)
  try {
    const model = home.session.model
    assert.ok(model)
    Reflect.set(home.session.agent.state, 'model', undefined)
    for (const message of ['first', 'second']) {
      await assert.rejects(sendClawasSessionMessage(home.session.sessionId, { message }), NO_MODEL)
      const status = await getClawasSessionStatus(home.session.sessionId)
      assert.equal(status?.hasPendingMessages, false)
      assert.match(status?.lastError ?? '', NO_MODEL)
    }
    const ctx = home.session.extensionRunner.createContext()
    home.pulses.attach(ctx)
    await home.pulses.scanAndRunDue(1_000)
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(home.pulses.scanAndRunDue(62_000), NO_MODEL)
    }
    assert.equal((await readPulseState(ctx.cwd)).pulses['main:check']?.lastRunAt, undefined)
    assert.equal(home.session.messages.length, 0)
    home.session.agent.state.model = model
    await assert.rejects(
      sendClawasSessionMessage(home.session.sessionId, { message: 'no auth' }),
      NO_AUTH,
    )
    assert.equal((await getClawasSessionStatus(home.session.sessionId))?.hasPendingMessages, false)
    await home.authenticate()
    const settled = home.turn()
    await sendClawasSessionMessage(home.session.sessionId, { message: 'after repair' })
    await settled
    assert.equal(home.prepared.length, 1)
    assert.deepEqual(home.errors, [])
    assert.equal((await getClawasSessionStatus(home.session.sessionId))?.hasPendingMessages, false)
  } finally {
    await home.close()
  }
})

test('first idle reports and manual main Pulses hydrate and attach through the native prompt path', {
  timeout: 10_000,
}, async (t) => {
  for (const wake of ['report', 'pulse']) {
    const home = await resident(t)
    try {
      assert.equal(home.workers.getState(), null)
      assert.equal(home.session.messages.length, 0)
      await home.authenticate()
      const settled = home.turn()
      if (wake === 'report') {
        await sendClawasSessionMessage(home.session.sessionId, {
          message: 'Worker completed',
          messageType: 'report',
          sender: { workerId: 'helper' },
        })
      } else {
        await home.session.prompt('/pulse run check')
      }
      await settled
      assert.equal(home.prepared.length, 1)
      assert.ok(home.prepared[0]!.includes('# Clawa personal assistant'))
      assert.ok(home.prepared[0]!.includes('WAKE_HOME_IDENTITY'))
      assert.ok(home.workers.getState())
      assert.equal((await home.pulses.list()).length, 1)
      const custom = home.session.sessionManager
        .getEntries()
        .find(
          (entry) =>
            entry.type === 'custom_message' &&
            entry.customType === (wake === 'report' ? 'clawas-report' : 'clawa-pulse'),
        )
      assert.ok(custom && custom.type === 'custom_message')
      const details = custom.details as Record<string, unknown>
      if (wake === 'report') assert.equal(details['workerId'], 'helper')
      else assert.equal(details['pulseId'], 'check')
      assert.deepEqual(home.errors, [])
    } finally {
      await home.close()
    }
  }
})
