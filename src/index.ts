import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { ClawasCommsServer } from './clawas/comms/server.js'
import { ClawasRuntime } from './clawas/runtime.js'
import {
  registerClawasMonitorShortcuts,
  registerJumpCommand,
  registerSteerCommand,
} from './clawas/steer-command.js'
import { registerClawasTools } from './clawas/tool-surface.js'
import { DEFAULT_CLAWA_DEFAULTS } from './config.js'
import { registerClawCommand } from './extension/claw-command.js'
import { extensionPath, IS_CLAWAS_WORKER } from './extension/constants.js'
import { getWorkerAlias } from './extension/environment.js'
import { registerHydrationContext } from './extension/hydration-context.js'
import { registerClawaRenderers } from './extension/renderers.js'
import { ClawaRuntimeState } from './extension/runtime-state.js'
import { registerClawaSessionEvents } from './extension/session-events.js'
import { registerRememberTool } from './memory.js'
import { registerMemoryPass } from './memory-pass.js'
import { registerNestedAgentsAutoload } from './nested-agents.js'
import { registerPulseCommand } from './pulses/command.js'
import { PulseRuntime } from './pulses/runtime.js'
import { registerRecallTool } from './recall.js'
import { registerClawaSystemPrompt } from './system-prompt.js'

process.env['PI_CLAW_EXTENSION_PATH'] = extensionPath

/** @public Pi loads the package extension through this default export. */
export default function howabouaClaw(pi: ExtensionAPI): void {
  const clawasRuntime = new ClawasRuntime()
  const pulseRuntime = new PulseRuntime(pi, clawasRuntime)
  const runtime = new ClawaRuntimeState()
  const commsServer = new ClawasCommsServer(pi, () => getWorkerAlias())
  let currentClawaDefaults = DEFAULT_CLAWA_DEFAULTS

  const setDefaults = (defaults: typeof DEFAULT_CLAWA_DEFAULTS) => {
    currentClawaDefaults = defaults
  }

  registerClawasTools(pi, clawasRuntime)
  registerRememberTool(pi)
  registerRecallTool(pi)
  registerMemoryPass(pi, () => currentClawaDefaults.memoryPass)
  registerClawaSystemPrompt(pi)
  registerNestedAgentsAutoload(pi)
  registerClawaRenderers(pi, () => currentClawaDefaults)

  if (!IS_CLAWAS_WORKER) {
    registerSteerCommand(pi, clawasRuntime)
    registerJumpCommand(pi, clawasRuntime)
    registerClawasMonitorShortcuts(pi, clawasRuntime)
    registerPulseCommand(pi, { runtime, clawasRuntime, pulseRuntime, setDefaults })
  }

  registerClawaSessionEvents(pi, { runtime, clawasRuntime, pulseRuntime, commsServer, setDefaults })
  // Session setup/bootstrap arms hydration before this later handler persists it.
  registerHydrationContext(pi, runtime)
  registerClawCommand(pi, { runtime, clawasRuntime, pulseRuntime, setDefaults })
}
