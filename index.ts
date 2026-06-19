import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
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
  DEFAULT_CLAWA_DEFAULTS,
  findRepoRoot,
  markClawEnvironmentBootstrapped,
  resolveClawaDefaults,
} from './config.js'
import { registerContinuityCompaction } from './continuity-compaction.js'
import { createNewClaw, executeBootstrap } from './extension/bootstrap-actions.js'
import { resolveBootstrapRequest, resolveCreateRequest } from './extension/command-args.js'
import {
  extensionPath,
  INITIAL_BOOTSTRAP_PROMPT,
  IS_CLAWAS_WORKER,
  mainTemplatesDir,
} from './extension/constants.js'
import { registerHydrationContext } from './extension/hydration-context.js'
import { ClawaRuntimeState } from './extension/runtime-state.js'
import {
  formatMessageContent,
  notifyInitialBootstrap,
  reportBootstrapBlocked,
} from './extension/ui-notes.js'
import { runClawGui } from './gui.js'
import { registerNestedAgentsAutoload } from './nested-agents.js'
import { registerClawaSystemPrompt } from './system-prompt.js'
import { copyTemplateFiles, findExistingCoreMarkdownFiles } from './template-files.js'

process.env.PI_CLAW_EXTENSION_PATH = extensionPath

// TEMP DEBUG PROBE.
// Leave false by default. Turn on only when tracing hydration, then turn it back off.
const DEBUG_HYDRATION_PROBE = false

function syncClawaEnvironment(cwd: string): void {
  const repoRoot = findRepoRoot(cwd)
  const clawaDefaults = resolveClawaDefaults(cwd)
  process.env.PI_CLAW_PROJECT_ROOT = repoRoot
  process.env.PI_CLAWAS_CONTROL_SOCKET_ROOT = `${repoRoot}/.pi`
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

function registerClawaRenderers(
  pi: ExtensionAPI,
  getCurrentDefaults: () => ReturnType<typeof resolveClawaDefaults>,
): void {
  pi.registerMessageRenderer('claw-dim', (message, _options, theme) => {
    const text = formatMessageContent(
      message.content as string | Array<{ type: string; text?: string }>,
    )
    return new Text(theme.fg('dim', text), 0, 0)
  })

  const clawasCommsRenderer = createClawasCommsRenderer(getCurrentDefaults)
  pi.registerMessageRenderer(CLAWAS_OUTBOUND_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer(CLAWAS_MAIL_MESSAGE_TYPE, clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-session', clawasCommsRenderer)
  pi.registerMessageRenderer('clawas-report', clawasCommsRenderer)
}

export default function howabouaClaw(pi: ExtensionAPI): void {
  const clawasRuntime = new ClawasRuntime()
  const runtime = new ClawaRuntimeState()
  const commsServer = new ClawasCommsServer(pi, () => getWorkerAlias())
  let currentClawaDefaults = DEFAULT_CLAWA_DEFAULTS

  registerClawasTools(pi, clawasRuntime)
  registerContinuityCompaction(pi)
  registerClawaSystemPrompt(pi)
  registerNestedAgentsAutoload(pi)
  registerHydrationContext(pi, runtime, { debugProbe: DEBUG_HYDRATION_PROBE })
  registerClawaRenderers(pi, () => currentClawaDefaults)

  if (!IS_CLAWAS_WORKER) {
    registerSteerCommand(pi, clawasRuntime)
    registerJumpCommand(pi, clawasRuntime)
    registerClawasMonitorShortcuts(pi, clawasRuntime)
  }

  const handleSessionStart = async (ctx: ExtensionContext): Promise<void> => {
    const extensionConfig = runtime.ensureExtensionConfig(ctx.cwd)
    currentClawaDefaults = resolveClawaDefaults(ctx.cwd)
    syncClawaEnvironment(ctx.cwd)
    maybeSetWorkerSessionName(pi, ctx)

    const needsInitialBootstrap = !extensionConfig.bootstrapped
    if (needsInitialBootstrap) {
      const conflicts = findExistingCoreMarkdownFiles(ctx.cwd)
      if (conflicts.length > 0) {
        reportBootstrapBlocked(pi, ctx, conflicts)
        return
      }

      const copied = await copyTemplateFiles(mainTemplatesDir, ctx.cwd)
      const marked = markClawEnvironmentBootstrapped(findRepoRoot(ctx.cwd))
      runtime.markBootstrapped(ctx.cwd)
      notifyInitialBootstrap(ctx, extensionConfig, copied, marked.path)
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus('clawa', undefined)
    }
    await commsServer.start(ctx)
    await runtime.armHydration(ctx.cwd)
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
    if (!IS_CLAWAS_WORKER) return

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

  pi.registerCommand('claw', {
    description: 'Open Clawa GUI or create/bootstrap claws',
    handler: async (args, ctx) => {
      runtime.ensureExtensionConfig(ctx.cwd)
      currentClawaDefaults = resolveClawaDefaults(ctx.cwd)
      syncClawaEnvironment(ctx.cwd)

      const create = resolveCreateRequest(args ?? '')
      if (create.run && create.name) {
        await createNewClaw(pi, ctx, { name: create.name })
        return
      }

      if (resolveBootstrapRequest(args ?? '')) {
        await executeBootstrap(pi, ctx, runtime)
        return
      }

      if (!ctx.hasUI) {
        await executeBootstrap(pi, ctx, runtime)
        return
      }

      await runClawGui(
        ctx,
        async () => await executeBootstrap(pi, ctx, runtime),
        async (createRequest) => await createNewClaw(pi, ctx, createRequest),
        clawasRuntime,
      )
    },
  })
}
