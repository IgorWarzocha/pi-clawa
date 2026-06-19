import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { bootstrapClawWorkspace, runBootstrap } from './bootstrap'
import { CLAWAS_MAIL_MESSAGE_TYPE, CLAWAS_OUTBOUND_MESSAGE_TYPE } from './clawas/comms/outbound.js'
import { createClawasCommsRenderer } from './clawas/comms/renderers.js'
import { reportFinalAssistantMessageToMain } from './clawas/comms/report-back.js'
import { ClawasCommsServer } from './clawas/comms/server.js'
import { ClawasRuntime } from './clawas/runtime.js'
import {
  registerClawasMonitorShortcuts,
  registerJumpCommand,
  registerSteerCommand,
} from './clawas/steer-command.js'
import { registerClawasTools } from './clawas/tool-surface.js'
import { getWorkerSessionName } from './clawas/worker-identity.js'
import {
  type ClawaConfig,
  DEFAULT_CLAWA_DEFAULTS,
  ensureClawEnvironmentConfig,
  findRepoRoot,
  loadClawEnvironmentConfig,
  markClawEnvironmentBootstrapped,
  resolveClawaDefaults,
  upsertClawConfig,
} from './config'
import { registerContinuityCompaction } from './continuity-compaction'
import { type CreateClawRequest, runClawGui } from './gui'
import { buildHydrationSystemPrompt, loadHydrationFiles } from './hydrate'
import { isClawBootstrapped, markClawBootstrapped } from './state'
import { registerClawaSystemPrompt } from './system-prompt'
import { copyTemplateFiles } from './template-files'

const extensionDir = dirname(fileURLToPath(import.meta.url))
process.env.PI_CLAW_EXTENSION_PATH = fileURLToPath(import.meta.url)
const templatesDir = join(extensionDir, 'templates')
const mainTemplatesDir = join(templatesDir, 'main')
const HYDRATION_MESSAGE_TYPE = 'claw-hydration'
const CLAWAS_ROLE = process.env.PI_CLAWAS_ROLE
const IS_CLAWAS_WORKER = CLAWAS_ROLE === 'worker'
const SPACE_SPLIT_REGEX = /\s+/

const INITIAL_BOOTSTRAP_PROMPT = [
  'This is the first Clawa bootstrap turn for this workspace.',
  'The extension has just created the main continuity files in the project root.',
  '',
  'Start by establishing the shape of this claw with the human:',
  '- your name',
  '- your nature and working style',
  '- your vibe and emoji',
  '- core user basics and preferences',
  '- boundaries for local work and external actions',
  '',
  'Persist the useful parts immediately into the appropriate files:',
  '- IDENTITY.md for stable self-description',
  '- USER.md for durable user preferences',
  '- SOUL.md for temperament and principles',
  '- MEMORY.md for concise durable memory',
  '- CURIOUS.md for sparks and open threads',
  '- TOOLS.md for local tooling notes',
].join('\n')

type RuntimeState = {
  cwd?: string
  extensionBootstrapped: boolean
  bootstrappedKnown: boolean
  bootstrapped: boolean
  needsHydrate: boolean
}

const runtime: RuntimeState = {
  extensionBootstrapped: true,
  bootstrappedKnown: false,
  bootstrapped: false,
  needsHydrate: false,
}

// TEMP DEBUG PROBE.
// Leave false by default. Turn on only when tracing hydration, then turn it back off.
const DEBUG_HYDRATION_PROBE = false

function formatMessageContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content
  return content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : '[non-text content]'))
    .join('\n')
    .trim()
}

function resolveBootstrapRequest(args: string): boolean {
  const normalized = args.trim().toLowerCase()
  if (!normalized) return false
  return normalized === 'bootstrap' || normalized === 'bootstrap-standard'
}

function resolveCreateRequest(args: string): {
  run: boolean
  name?: string
} {
  const trimmed = args.trim()
  if (!trimmed) return { run: false }

  const parts = trimmed.split(SPACE_SPLIT_REGEX).filter(Boolean)
  const first = parts[0]?.toLowerCase()
  if (first !== 'create' && first !== 'new') {
    return { run: false }
  }

  const name = parts.find((part, index) => index > 0 && part.toLowerCase() !== 'standard')
  return { run: true, name }
}

async function ensureBootstrapped(cwd: string): Promise<boolean> {
  if (runtime.cwd !== cwd) {
    runtime.cwd = cwd
    runtime.bootstrappedKnown = false
    runtime.bootstrapped = false
    runtime.needsHydrate = false
  }
  if (!runtime.bootstrappedKnown) {
    runtime.bootstrapped = await isClawBootstrapped(cwd)
    runtime.bootstrappedKnown = true
  }
  return runtime.bootstrapped
}

function ensureExtensionConfig(cwd: string): {
  bootstrapped: boolean
  created: boolean
  path: string
} {
  if (IS_CLAWAS_WORKER) {
    runtime.extensionBootstrapped = true
    return { bootstrapped: true, created: false, path: '' }
  }

  const repoRoot = findRepoRoot(cwd)
  const loaded = ensureClawEnvironmentConfig(repoRoot)
  runtime.extensionBootstrapped = loaded.config.bootstrapped === true
  return {
    bootstrapped: runtime.extensionBootstrapped,
    created: loaded.created,
    path: loaded.path,
  }
}

function setBootstrappedRuntime(cwd: string): void {
  runtime.cwd = cwd
  runtime.bootstrappedKnown = true
  runtime.bootstrapped = true
  runtime.needsHydrate = true
}

async function armHydration(cwd: string): Promise<boolean> {
  await ensureBootstrapped(cwd)
  runtime.needsHydrate = true
  return runtime.bootstrapped
}

function sendDimNote(pi: ExtensionAPI, text: string): void {
  pi.sendMessage({ customType: 'claw-dim', content: text, display: true })
}

function buildHydrationProbeNote(text: string): string {
  const markers = [
    ['continuity', '## Claw Continuity Refresh (auto-loaded)'],
    ['IDENTITY', '--- BEGIN IDENTITY.md ---'],
    ['SOUL', '--- BEGIN SOUL.md ---'],
    ['USER', '--- BEGIN USER.md ---'],
    ['MEMORY', '--- BEGIN MEMORY.md ---'],
    ['CURIOUS', '--- BEGIN CURIOUS.md ---'],
    ['TOOLS', '--- BEGIN TOOLS.md ---'],
    ['sad heading', '## The `sad` State'],
  ] as const

  const found = markers.filter(([, needle]) => text.includes(needle)).map(([label]) => label)
  const missing = markers.filter(([, needle]) => !text.includes(needle)).map(([label]) => label)
  const beginBlocks = (text.match(/--- BEGIN .*? ---/g) || []).length

  return [
    'claw hydration probe:',
    `- payload chars: ${text.length}`,
    `- BEGIN blocks: ${beginBlocks}`,
    `- found: ${found.length > 0 ? found.join(', ') : 'none'}`,
    `- missing: ${missing.length > 0 ? missing.join(', ') : 'none'}`,
  ].join('\n')
}

async function buildHydrationText(
  cwd: string,
): Promise<{ kind: 'continuity'; text: string } | null> {
  const bootstrapped = await ensureBootstrapped(cwd)
  if (!bootstrapped) return null

  const files = await loadHydrationFiles(cwd)
  if (files.length === 0) return null
  const contextBlock = buildHydrationSystemPrompt(files)
  return contextBlock.trim() ? { kind: 'continuity', text: contextBlock } : null
}

async function executeBootstrap(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const result = await runBootstrap(ctx.cwd, mainTemplatesDir)
  setBootstrappedRuntime(ctx.cwd)
  markClawEnvironmentBootstrapped(findRepoRoot(ctx.cwd))

  sendDimNote(
    pi,
    [
      'claw bootstrap complete',
      'claw loaded workspace files:',
      ...result.loadedFiles.map((file) => `- ${file.name} (${file.chars} chars)`),
      `state: ${result.statePath}`,
    ].join('\n'),
  )

  if (ctx.hasUI) {
    ctx.ui.notify(
      `Bootstrap complete: ${result.created} created, ${result.overwritten} overwritten`,
      'info',
    )
  }

  return result
}

async function createNewClaw(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  request: CreateClawRequest,
) {
  const repoRoot = findRepoRoot(ctx.cwd)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const safeName = request.name.trim()
  const relativePath = join(loaded.config.clawas.baseDir, safeName)
  const absolutePath = resolve(repoRoot, relativePath)
  await bootstrapClawWorkspace(absolutePath, mainTemplatesDir)

  const claw: ClawaConfig = {
    name: safeName,
    path: relativePath,
    autostart: false,
  }
  const saved = upsertClawConfig(repoRoot, claw)

  sendDimNote(
    pi,
    [`new claw created: ${safeName}`, `path: ${relativePath}`, `config: ${saved.path}`].join('\n'),
  )

  if (ctx.hasUI) {
    ctx.ui.notify(`Created ${safeName} at ${relativePath}`, 'info')
  }

  return { name: safeName, path: relativePath }
}

function syncClawaEnvironment(cwd: string): void {
  const repoRoot = findRepoRoot(cwd)
  const clawaDefaults = resolveClawaDefaults(cwd)
  process.env.PI_CLAW_PROJECT_ROOT = repoRoot
  process.env.PI_CLAWAS_CONTROL_SOCKET_ROOT = join(repoRoot, '.pi')
  process.env.PI_CLAWAS_CONTROL_SOCKET_DIR = clawaDefaults.controlSocketDir
}

function getWorkerAlias(): string | undefined {
  if (!IS_CLAWAS_WORKER) {
    return 'main-claw'
  }
  return process.env.PI_CLAWAS_SOCKET_ALIAS?.trim() || undefined
}

function sendInitialBootstrapPrompt(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.isIdle()) {
    pi.sendUserMessage(INITIAL_BOOTSTRAP_PROMPT)
    return
  }

  pi.sendUserMessage(INITIAL_BOOTSTRAP_PROMPT, { deliverAs: 'followUp' })
}

function maybeSetWorkerSessionName(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!IS_CLAWAS_WORKER) {
    return
  }

  const workerId = process.env.PI_CLAWAS_WORKER_ID?.trim()
  const workerTitle = process.env.PI_CLAWAS_WORKER_TITLE?.trim() || workerId
  if (!(workerId && workerTitle)) {
    return
  }

  pi.setSessionName(
    getWorkerSessionName(
      {
        id: workerId,
        title: workerTitle,
        cwd: ctx.cwd,
        enabled: true,
        autostart: false,
      },
      resolveClawaDefaults(ctx.cwd),
    ),
  )
}

export default function howabouaClaw(pi: ExtensionAPI): void {
  const clawasRuntime = new ClawasRuntime()
  const commsServer = new ClawasCommsServer(pi, () => getWorkerAlias())
  let currentClawaDefaults = DEFAULT_CLAWA_DEFAULTS

  registerClawasTools(pi, clawasRuntime)
  registerContinuityCompaction(pi)
  registerClawaSystemPrompt(pi)
  if (!IS_CLAWAS_WORKER) {
    registerSteerCommand(pi, clawasRuntime)
    registerJumpCommand(pi, clawasRuntime)
    registerClawasMonitorShortcuts(pi, clawasRuntime)
  }

  pi.registerMessageRenderer('claw-dim', (message, _options, theme) => {
    const text = formatMessageContent(
      message.content as string | Array<{ type: string; text?: string }>,
    )
    return new Text(theme.fg('dim', text), 0, 0)
  })
  const clawasCommsRenderer = createClawasCommsRenderer(() => currentClawaDefaults)
  pi.registerMessageRenderer(CLAWAS_OUTBOUND_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer(CLAWAS_MAIL_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-session', clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-report', clawasCommsRenderer)

  const handleSessionStart = async (ctx: ExtensionContext): Promise<void> => {
    const extensionConfig = ensureExtensionConfig(ctx.cwd)
    currentClawaDefaults = resolveClawaDefaults(ctx.cwd)
    syncClawaEnvironment(ctx.cwd)
    maybeSetWorkerSessionName(pi, ctx)

    const needsInitialBootstrap = !extensionConfig.bootstrapped
    if (needsInitialBootstrap) {
      const copied = await copyTemplateFiles(mainTemplatesDir, ctx.cwd)
      await markClawBootstrapped(ctx.cwd)
      const marked = markClawEnvironmentBootstrapped(findRepoRoot(ctx.cwd))
      runtime.extensionBootstrapped = true
      setBootstrappedRuntime(ctx.cwd)
      if (ctx.hasUI) {
        ctx.ui.setStatus('clawa', 'clawa: bootstrapping')
        if (extensionConfig.created) {
          ctx.ui.notify(`Clawa config created at ${extensionConfig.path}`, 'info')
        }
        ctx.ui.notify(
          `Clawa initialized ${copied.copied.length} main files and marked ${marked.path} bootstrapped`,
          'info',
        )
      }
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus('clawa', undefined)
    }
    await commsServer.start(ctx)
    await armHydration(ctx.cwd)
    if (!IS_CLAWAS_WORKER) {
      clawasRuntime.attach(ctx)
    }
    if (needsInitialBootstrap) {
      sendInitialBootstrapPrompt(pi, ctx)
    }
  }

  pi.on('session_start', async (event, ctx) => {
    // Pi 0.65.0 removed session_switch/session_fork. session_start now fires for
    // startup, reload, new, resume, and fork with event.reason carrying the lane.
    // Our clawa wants the same reattach/hydration/comms path for all of them.
    void event
    await handleSessionStart(ctx)
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!IS_CLAWAS_WORKER) {
      return
    }

    await reportFinalAssistantMessageToMain(pi, ctx, {
      workerId: process.env.PI_CLAWAS_WORKER_ID,
      workerTitle: process.env.PI_CLAWAS_WORKER_TITLE,
      targetSessionId: process.env.PI_CLAWAS_REPORT_SESSION_ID,
      agentMessages: event.messages,
    })
  })

  pi.on('session_shutdown', async () => {
    await commsServer.stop()
    if (!IS_CLAWAS_WORKER) {
      await clawasRuntime.dispose()
    }
  })

  pi.on('session_compact', async (_event, ctx) => {
    await armHydration(ctx.cwd)
    if (DEBUG_HYDRATION_PROBE && ctx.hasUI) {
      ctx.ui.notify('claw: workspace context will reload on the next turn.', 'info')
    }
  })

  pi.on('context', async (event, ctx) => {
    if (!runtime.extensionBootstrapped) return undefined
    await ensureBootstrapped(ctx.cwd)
    if (!runtime.needsHydrate) return undefined

    const baseMessages = Array.isArray(event.messages) ? event.messages : []
    const hydrated = await buildHydrationText(ctx.cwd)
    runtime.needsHydrate = false
    if (!hydrated) return undefined

    const messages = baseMessages.filter((message) => {
      return !(
        message &&
        typeof message === 'object' &&
        'role' in message &&
        message.role === 'custom' &&
        'customType' in message &&
        message.customType === HYDRATION_MESSAGE_TYPE
      )
    })

    const injected = {
      role: 'custom' as const,
      customType: HYDRATION_MESSAGE_TYPE,
      content: hydrated.text,
      display: false,
      details: { kind: hydrated.kind },
      timestamp: Date.now(),
    }

    if (DEBUG_HYDRATION_PROBE && ctx.hasUI) {
      ctx.ui.notify(buildHydrationProbeNote(hydrated.text), 'info')
    }

    return { messages: [...messages, injected] }
  })

  pi.registerCommand('claw', {
    description: 'Open Clawa GUI or create/bootstrap claws',
    handler: async (args, ctx) => {
      ensureExtensionConfig(ctx.cwd)
      currentClawaDefaults = resolveClawaDefaults(ctx.cwd)
      syncClawaEnvironment(ctx.cwd)
      const create = resolveCreateRequest(args ?? '')
      if (create.run && create.name) {
        await createNewClaw(pi, ctx, { name: create.name })
        return
      }

      const shouldBootstrap = resolveBootstrapRequest(args ?? '')
      if (shouldBootstrap) {
        await executeBootstrap(pi, ctx)
        return
      }

      if (!ctx.hasUI) {
        await executeBootstrap(pi, ctx)
        return
      }

      await runClawGui(
        ctx,
        async () => await executeBootstrap(pi, ctx),
        async (createRequest) => await createNewClaw(pi, ctx, createRequest),
        clawasRuntime,
      )
    },
  })
}
