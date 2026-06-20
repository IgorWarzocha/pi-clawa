import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { reportFinalAssistantMessageToMain } from '../clawas/comms/report-back.js'
import type { ClawasCommsServer } from '../clawas/comms/server.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import {
  type ClawaDefaults,
  findRepoRoot,
  markClawEnvironmentBootstrapped,
  resolveClawaDefaults,
} from '../config.js'
import { copyTemplateFiles, findExistingCoreMarkdownFiles } from '../template-files.js'
import { IS_CLAWAS_WORKER, mainTemplatesDir } from './constants.js'
import {
  maybeSetWorkerSessionName,
  sendInitialBootstrapPrompt,
  syncClawaEnvironment,
} from './environment.js'
import type { ClawaRuntimeState } from './runtime-state.js'
import { notifyInitialBootstrap, reportBootstrapBlocked } from './ui-notes.js'

export function registerClawaSessionEvents(
  pi: ExtensionAPI,
  options: {
    runtime: ClawaRuntimeState
    clawasRuntime: ClawasRuntime
    commsServer: ClawasCommsServer
    setDefaults: (defaults: ClawaDefaults) => void
  },
): void {
  const handleSessionStart = async (ctx: ExtensionContext): Promise<void> => {
    const extensionConfig = options.runtime.ensureExtensionConfig(ctx.cwd)
    options.setDefaults(resolveClawaDefaults(ctx.cwd))
    syncClawaEnvironment(ctx.cwd)
    maybeSetWorkerSessionName(pi, ctx)

    const needsInitialBootstrap = !extensionConfig.bootstrapped
    if (needsInitialBootstrap) {
      const bootstrapped = await runInitialBootstrap(pi, ctx, options.runtime)
      if (!bootstrapped) return
    }

    if (ctx.hasUI) ctx.ui.setStatus('clawa', undefined)
    await options.commsServer.start(ctx)
    await options.runtime.armHydration(ctx.cwd)
    if (!IS_CLAWAS_WORKER) options.clawasRuntime.attach(ctx)
    if (needsInitialBootstrap) sendInitialBootstrapPrompt(pi, ctx)
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
      workerId: process.env['PI_CLAWAS_WORKER_ID'],
      workerTitle: process.env['PI_CLAWAS_WORKER_TITLE'],
      targetSessionId: process.env['PI_CLAWAS_REPORT_SESSION_ID'],
      agentMessages: event.messages,
    })
  })

  pi.on('session_shutdown', async () => {
    await options.commsServer.stop()
    if (!IS_CLAWAS_WORKER) await options.clawasRuntime.dispose()
  })
}

async function runInitialBootstrap(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  runtime: ClawaRuntimeState,
): Promise<boolean> {
  const conflicts = findExistingCoreMarkdownFiles(ctx.cwd)
  if (conflicts.length > 0) {
    reportBootstrapBlocked(pi, ctx, conflicts)
    return false
  }

  const copied = await copyTemplateFiles(mainTemplatesDir, ctx.cwd)
  const marked = markClawEnvironmentBootstrapped(findRepoRoot(ctx.cwd))
  runtime.markBootstrapped(ctx.cwd)
  notifyInitialBootstrap(ctx, runtime.ensureExtensionConfig(ctx.cwd), copied, marked.path)
  return true
}
