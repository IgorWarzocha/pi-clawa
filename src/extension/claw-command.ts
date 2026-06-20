import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ClawasRuntime } from '../clawas/runtime.js'
import { type ClawaDefaults, resolveClawaDefaults } from '../config.js'
import { runClawGui } from '../gui.js'
import type { PulseRuntime } from '../pulses/runtime.js'
import { executeBootstrap } from './bootstrap-actions.js'
import { createNewClaw } from './clawa-seed.js'
import { resolveBootstrapRequest, resolveCreateRequest } from './command-args.js'
import { IS_CLAWAS_WORKER } from './constants.js'
import { syncClawaEnvironment } from './environment.js'
import type { ClawaRuntimeState } from './runtime-state.js'

export function registerClawCommand(
  pi: ExtensionAPI,
  options: {
    runtime: ClawaRuntimeState
    clawasRuntime: ClawasRuntime
    pulseRuntime: PulseRuntime
    setDefaults: (defaults: ClawaDefaults) => void
  },
): void {
  pi.registerCommand('claw', {
    description: 'Open Clawa GUI or create/bootstrap claws',
    handler: async (args, ctx) => {
      if (IS_CLAWAS_WORKER) {
        ctx.ui.notify('/claw belongs in the main Clawa session.', 'warning')
        return
      }

      options.runtime.ensureExtensionConfig(ctx.cwd)
      options.setDefaults(resolveClawaDefaults(ctx.cwd))
      syncClawaEnvironment(ctx.cwd)

      const create = resolveCreateRequest(args ?? '')
      if (create.run && create.purpose) {
        await createNewClaw(pi, ctx, { purpose: create.purpose }, options.clawasRuntime)
        return
      }

      if (resolveBootstrapRequest(args ?? '') || !ctx.hasUI) {
        await executeBootstrap(pi, ctx, options.runtime)
        return
      }

      await runClawGui(
        ctx,
        async () => await executeBootstrap(pi, ctx, options.runtime),
        async (createRequest) => await createNewClaw(pi, ctx, createRequest, options.clawasRuntime),
        options.clawasRuntime,
        options.pulseRuntime,
      )
    },
  })
}
