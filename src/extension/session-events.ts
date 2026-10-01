import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { reportFinalAssistantMessageToMain } from '../clawas/comms/report-back.js'
import type { ClawasCommsServer } from '../clawas/comms/server.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { ClawaContextSharing } from '../clawas/shared-context.js'
import { type ClawaDefaults, resolveClawaDefaults } from '../config.js'
import type { PulseRuntime } from '../pulses/runtime.js'
import { clawaInstallScope, resolveActiveHome } from './activation.js'
import { bootstrapMainHome } from './bootstrap-actions.js'
import { IS_CLAWAS_WORKER } from './constants.js'
import { maybeSetWorkerSessionName, syncClawaEnvironment } from './environment.js'
import { INITIAL_BOOTSTRAP_PROMPT } from './onboarding.js'
import type { ClawaRuntimeState } from './runtime-state.js'
import { notifyInitialBootstrap, reportBootstrapBlocked } from './ui-notes.js'

export function registerClawaSessionEvents(
  pi: ExtensionAPI,
  options: {
    runtime: ClawaRuntimeState
    clawasRuntime: ClawasRuntime
    pulseRuntime: PulseRuntime
    commsServer: ClawasCommsServer
    sharedContext: ClawaContextSharing
    setDefaults: (defaults: ClawaDefaults) => void
  },
): (ctx: ExtensionContext) => Promise<void> {
  let attached = false
  const detach = async (): Promise<void> => {
    attached = false
    // Fence/abort sharing before waiting for launches that may themselves be binding a child.
    options.sharedContext.detach()
    await options.commsServer.stop()
    await options.pulseRuntime.dispose()
    await options.clawasRuntime.dispose()
  }
  const prepare = async (ctx: ExtensionContext): Promise<void> => {
    if (!options.runtime.active) throw new Error('Clawa is not active in this session')
    if (attached) return
    if (!IS_CLAWAS_WORKER) {
      options.clawasRuntime.attach(ctx)
      await options.clawasRuntime.refreshFromConfig()
      options.pulseRuntime.attach(ctx)
    }
    attached = true
  }
  const handleSessionStart = async (ctx: ExtensionContext): Promise<void> => {
    options.runtime.active = false
    options.runtime.onboardingPending = false
    await detach()
    const homeRoot = resolveActiveHome(ctx.cwd, clawaInstallScope(pi))
    options.runtime.homeRoot = homeRoot
    options.runtime.bootstrappedKnown = false
    if (!homeRoot) return

    const extensionConfig = options.runtime.ensureExtensionConfig(ctx.cwd)
    const needsInitialBootstrap = !extensionConfig.bootstrapped
    if (needsInitialBootstrap) {
      const bootstrapped = await bootstrapMainHome(ctx.cwd, options.runtime)
      if (bootstrapped.kind === 'blocked') {
        reportBootstrapBlocked(ctx, bootstrapped.conflicts)
        return
      }
      notifyInitialBootstrap(ctx, extensionConfig, bootstrapped.copied, bootstrapped.markedPath)
    }

    syncClawaEnvironment(ctx.cwd, homeRoot)
    options.setDefaults(resolveClawaDefaults(ctx.cwd))
    maybeSetWorkerSessionName(pi, ctx)
    // The Clawa launcher waits for this listener before delivering a worker's first task.
    // Listening does not write to the transcript or start a turn, so fresh binding stays safe.
    await options.commsServer.start(ctx)
    options.runtime.active = true
    options.runtime.onboardingPending = needsInitialBootstrap
    if (ctx.hasUI) ctx.ui.setStatus('clawa', undefined)
  }

  pi.on('session_start', async (event, ctx) => {
    // Pi 0.65.0 removed session_switch/session_fork. session_start now fires for
    // startup, reload, new, resume, and fork with event.reason carrying the lane.
    // Our clawa wants the same reattach/hydration/comms path for all of them.
    void event
    await handleSessionStart(ctx)
  })

  // A fresh resident must remain idle and transcript-empty until any optional binding finishes.
  pi.on('before_agent_start', async (event, ctx) => {
    if (!options.runtime.active) return
    await prepare(ctx)
    if (options.runtime.onboardingPending)
      event.systemPromptOptions.sections['clawa_onboarding'] = INITIAL_BOOTSTRAP_PROMPT
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!options.runtime.active) return
    options.commsServer.publishStatus()
    if (!IS_CLAWAS_WORKER) return

    await reportFinalAssistantMessageToMain(pi, ctx, {
      workerId: process.env['PI_CLAWAS_WORKER_ID'],
      workerTitle: process.env['PI_CLAWAS_WORKER_TITLE'],
      targetSessionId: process.env['PI_CLAWAS_REPORT_SESSION_ID'],
      agentMessages: event.messages,
    })
  })

  pi.on('agent_start', () => {
    if (!options.runtime.active) return
    options.runtime.onboardingPending = false
    options.commsServer.agentStart()
  })
  pi.on('agent_settled', () => {
    if (options.runtime.active) options.commsServer.agentSettled()
  })
  pi.on('tool_execution_start', (event) => {
    if (options.runtime.active) options.commsServer.toolStart(event.toolCallId, event.toolName)
  })
  pi.on('tool_execution_end', (event) => {
    if (options.runtime.active)
      options.commsServer.toolEnd(event.toolCallId, event.toolName, event.isError)
  })
  pi.on('message_end', (event) => {
    if (!options.runtime.active) return
    if (event.message.role !== 'assistant') return
    options.commsServer.assistantMessage(
      event.message.content,
      event.message.stopReason === 'error' ? event.message.errorMessage : undefined,
    )
  })

  pi.on('session_shutdown', detach)
  return prepare
}
