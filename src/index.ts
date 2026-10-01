import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { ClawasCommsServer } from './clawas/comms/server.js'
import { ClawasRuntime } from './clawas/runtime.js'
import { ClawaContextSharing } from './clawas/shared-context.js'
import {
  registerClawasMonitorShortcuts,
  registerJumpCommand,
  registerSteerCommand,
} from './clawas/steer-command.js'
import { registerClawasTools } from './clawas/tool-surface.js'
import { DEFAULT_CLAWA_DEFAULTS } from './config.js'
import { registerContextManagement } from './context-management/index.js'
import { registerClawCommand } from './extension/claw-command.js'
import { IS_CLAWAS_WORKER, skillsDir } from './extension/constants.js'
import { getWorkerAlias } from './extension/environment.js'
import { registerHydrationContext } from './extension/hydration-context.js'
import { registerClawaRenderers } from './extension/renderers.js'
import { ClawaRuntimeState } from './extension/runtime-state.js'
import { registerClawaSessionEvents } from './extension/session-events.js'
import {
  registerClawaCodeModeTools,
  registerClawaToolAvailability,
} from './extension/tool-availability.js'
import { registerNestedAgentsAutoload } from './nested-agents.js'
import { registerPulseCommand } from './pulses/command.js'
import { PulseRuntime } from './pulses/runtime.js'
import { registerClawaSystemPrompt } from './system-prompt.js'

/** @public Pi loads the package extension through this default export. */
export default async function howabouaClaw(pi: ExtensionAPI): Promise<void> {
  const runtime = new ClawaRuntimeState()
  const isActive = () => runtime.active
  const sharedContext = new ClawaContextSharing(pi, isActive)
  const clawasRuntime = new ClawasRuntime((ctx, workerId) => sharedContext.prepare(ctx, workerId))
  const pulseRuntime = new PulseRuntime(pi, clawasRuntime)
  const commsServer = new ClawasCommsServer(pi, () => getWorkerAlias(), sharedContext)
  let currentClawaDefaults = DEFAULT_CLAWA_DEFAULTS

  const setDefaults = (defaults: typeof DEFAULT_CLAWA_DEFAULTS) => {
    currentClawaDefaults = defaults
  }

  // Activation is resolved before any home-specific startup hooks.
  const prepare = registerClawaSessionEvents(pi, {
    runtime,
    clawasRuntime,
    pulseRuntime,
    commsServer,
    sharedContext,
    setDefaults,
  })
  await sharedContext.register()
  const messageTools = registerClawasTools(pi, clawasRuntime, isActive, (ctx) =>
    sharedContext.describe(ctx),
  )
  registerClawaSystemPrompt(pi, isActive)
  registerNestedAgentsAutoload(pi, isActive)
  registerClawaRenderers(pi, () => currentClawaDefaults)

  if (!IS_CLAWAS_WORKER) {
    registerSteerCommand(pi, clawasRuntime, prepare)
    registerJumpCommand(pi, clawasRuntime, prepare)
    registerClawasMonitorShortcuts(pi, clawasRuntime)
    registerPulseCommand(pi, { runtime, clawasRuntime, pulseRuntime, setDefaults, prepare })
  }

  registerHydrationContext(pi, runtime)
  const memoryTools = registerContextManagement(pi, runtime)
  registerClawCommand(pi, { runtime, clawasRuntime, pulseRuntime, setDefaults, prepare })
  pi.on('resources_discover', () => (runtime.active ? { skillPaths: [skillsDir] } : undefined))
  const tools = [...messageTools, ...memoryTools]
  registerClawaToolAvailability(pi, tools, isActive)
  await registerClawaCodeModeTools(pi, tools, isActive)
}
