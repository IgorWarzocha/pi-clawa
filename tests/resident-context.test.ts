import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import codex from '@howaboua/pi-codex-conversion'
import { getClawasSessionStatus, requestClawasContext } from '../src/clawas/comms/client.js'
import { ClawasCommsServer } from '../src/clawas/comms/server.js'
import { ClawaContextSharing } from '../src/clawas/shared-context.js'

const environmentKeys = ['PI_CODING_AGENT_DIR', 'PI_CLAWAS_CONTROL_SOCKET_ROOT'] as const
const FAMILY_ERROR = /family/u
const REBIND_ERROR = /cannot be rebound/u
const MISSING_NOTES_ERROR = /needs Pi Codex with notes-based continuity/u
const STALE_CONTEXT_ERROR = /session changed/u
const SHARED_CONTENT = /shared through Clawa/u

// Load real Pi and Codex, but never start an agent turn or contact a provider.
async function resident(
  root: string,
  name: string,
  runtimes: AgentSessionRuntime[],
  plain = false,
) {
  const cwd = join(root, name)
  const agentDir = join(root, 'agent')
  await mkdir(cwd)
  let sharing: ClawaContextSharing | undefined
  const errors: string[] = []
  const create: CreateAgentSessionRuntimeFactory = async (options) => {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(agentDir, `${name}-models.json`),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const services = await createAgentSessionServices({
      cwd: options.cwd,
      agentDir,
      modelRuntime,
      settingsManager: SettingsManager.inMemory(),
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        extensionFactories: [
          ...(plain ? [] : [codex]),
          async (pi) => {
            const context = new ClawaContextSharing(pi, () => true)
            sharing = context
            const server = new ClawasCommsServer(pi, () => undefined, context)
            pi.on('session_start', async (_event, ctx) => {
              context.detach()
              await server.start(ctx)
            })
            pi.on('session_shutdown', async () => {
              context.detach()
              await server.stop()
            })
            await context.register()
          },
        ],
      },
    })
    const extensionErrors = services.resourceLoader.getExtensions().errors
    if (extensionErrors.length > 0) throw new Error(JSON.stringify(extensionErrors))
    const model = modelRuntime.getModel('openai', 'gpt-4.1')
    if (!model) throw new Error('Pi static model catalog is unavailable')
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      ...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
      model,
    })
    return { ...created, services, diagnostics: services.diagnostics }
  }
  const runtime = await createAgentSessionRuntime(create, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd, join(cwd, 'sessions')),
  })
  runtimes.push(runtime)
  const bind = async () => {
    await runtime.session.bindExtensions({ onError: (error) => errors.push(error.error) })
    if (errors.length > 0) throw new Error(errors.join('\n'))
  }
  runtime.setRebindSession(bind)
  await bind()
  return {
    runtime,
    context: () => runtime.session.extensionRunner.createContext(),
    sharing: () => {
      if (!sharing) throw new Error('Resident fixture has no context adapter')
      return sharing
    },
    notes: async (params: Record<string, unknown>) => {
      const tool = runtime.services.resourceLoader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.tools.values()])
        .find((entry) => entry.definition.name === 'notes')?.definition
      if (!tool) throw new Error('Codex notes tool is unavailable')
      return tool.execute(
        'context-proof',
        params,
        undefined,
        undefined,
        runtime.session.extensionRunner.createContext(),
      )
    },
  }
}

type Resident = Awaited<ReturnType<typeof resident>>

async function bindChild(parent: Resident, child: Resident, name: string) {
  const prepared = await parent.sharing().prepare(parent.context(), name)
  if (!prepared) throw new Error('Codex sharing is disabled in the parent')
  const status = await getClawasSessionStatus(child.runtime.session.sessionId)
  if (!status) throw new Error('Resident socket is unavailable')
  return prepared.accept(status)
}

function persistSession(client: Resident): string {
  const manager = client.runtime.session.sessionManager
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Session persistence boundary' }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4.1',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  })
  const file = manager.getSessionFile()
  if (!file) throw new Error('Resident fixture has no persistent session')
  return file
}

test('native Codex families route through Clawa alone and survive resident resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clawa-context-'))
  const agentDir = join(root, 'agent')
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]))
  const runtimes: AgentSessionRuntime[] = []
  try {
    process.env['PI_CODING_AGENT_DIR'] = agentDir
    process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = root
    await mkdir(agentDir)
    for (const storage of ['local', 'tree']) {
      await writeFile(
        join(agentDir, 'pi-codex-conversion.json'),
        JSON.stringify({
          executionMode: 'normal',
          scope: { allProviders: 'on' },
          compaction: {
            continuity: 'notes',
            historyStorage: storage,
            shareSubagentContext: true,
          },
          voice: { autoResumeRealtime: false },
          ui: { statusLine: false },
        }),
      )
      const parent = await resident(root, `${storage}-parent`, runtimes)
      const child = await resident(root, `${storage}-child`, runtimes)
      const sibling = await resident(root, `${storage}-sibling`, runtimes)
      const plain = await resident(root, `${storage}-plain`, runtimes, true)
      assert.equal(await plain.sharing().prepare(plain.context(), 'child'), undefined)
      await assert.rejects(() => bindChild(parent, plain, 'plain'), MISSING_NOTES_ERROR)
      const identity = await bindChild(parent, child, 'inbox.triage')
      await bindChild(parent, sibling, 'sibling')
      await child.notes({ action: 'write_file', path: 'proof', text: 'shared through Clawa' })
      const read = { action: 'read_file', path: `${identity.agentName}/notes/proof` }
      assert.match(JSON.stringify(await parent.notes(read)), SHARED_CONTENT)
      assert.match(JSON.stringify(await sibling.notes(read)), SHARED_CONTENT)
      await assert.rejects(() => bindChild(parent, child, 'replacement'), REBIND_ERROR)
      await assert.rejects(
        () =>
          requestClawasContext(child.runtime.session.sessionId, {
            type: 'context',
            operation: 'execute',
            visited: [],
            request: {
              sessionId: 'foreign-family',
              agentName: identity.agentName,
              namespace: 'notes',
              params: { action: 'read_file', path: 'proof' },
            },
          }),
        FAMILY_ERROR,
      )
      const saved = persistSession(child)
      await child.runtime.newSession()
      assert.notEqual(child.sharing().describe(child.context())?.sessionId, identity.sessionId)
      await child.runtime.switchSession(saved)
      assert.deepEqual(child.sharing().describe(child.context()), identity)
      assert.match(JSON.stringify(await parent.notes(read)), SHARED_CONTENT)
      const stale = await parent.sharing().prepare(parent.context(), 'cancelled')
      assert.ok(stale)
      parent.sharing().detach()
      const status = await getClawasSessionStatus(child.runtime.session.sessionId)
      assert.ok(status)
      await assert.rejects(() => stale.accept(status), STALE_CONTEXT_ERROR)
      assert.deepEqual(child.sharing().describe(child.context()), identity)
    }
  } finally {
    for (const runtime of runtimes.reverse()) await runtime.dispose()
    for (const key of environmentKeys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  }
})
