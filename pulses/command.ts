import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { ClawasRuntime } from '../clawas/runtime.js'
import { type ClawaDefaults, resolveClawaDefaults } from '../config.js'
import { executeBootstrap } from '../extension/bootstrap-actions.js'
import { createNewClaw } from '../extension/clawa-seed.js'
import { syncClawaEnvironment } from '../extension/environment.js'
import type { ClawaRuntimeState } from '../extension/runtime-state.js'
import { runClawGui } from '../gui.js'
import type { PulseRuntime } from './runtime.js'

const SPACE_PATTERN = /\s+/u

function usage(): string {
  return ['Usage:', '/pulse', '/pulse run <pulse-id|owner:pulse-id|title>'].join('\n')
}

async function openPulsesGui(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: {
    runtime: ClawaRuntimeState
    clawasRuntime: ClawasRuntime
    pulseRuntime: PulseRuntime
    setDefaults: (defaults: ClawaDefaults) => void
  },
): Promise<void> {
  options.runtime.ensureExtensionConfig(ctx.cwd)
  options.setDefaults(resolveClawaDefaults(ctx.cwd))
  syncClawaEnvironment(ctx.cwd)

  if (!ctx.hasUI) {
    ctx.ui.notify(usage(), 'warning')
    return
  }

  await runClawGui(
    ctx,
    async () => await executeBootstrap(pi, ctx, options.runtime),
    async (createRequest) => await createNewClaw(pi, ctx, createRequest, options.clawasRuntime),
    options.clawasRuntime,
    options.pulseRuntime,
    'pulses',
  )
}

async function runPulse(
  runtime: PulseRuntime,
  target: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!target) {
    ctx.ui.notify(usage(), 'warning')
    return
  }
  try {
    const pulse = await runtime.runNow(target)
    ctx.ui.notify(`Queued pulse ${pulse.title}.`, 'info')
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

export function registerPulseCommand(
  pi: ExtensionAPI,
  options: {
    runtime: ClawaRuntimeState
    clawasRuntime: ClawasRuntime
    pulseRuntime: PulseRuntime
    setDefaults: (defaults: ClawaDefaults) => void
  },
): void {
  pi.registerCommand('pulse', {
    description: 'Open Clawa pulses or run one pulse directly',
    handler: async (args, ctx) => {
      const [command, ...rest] = (args ?? '').trim().split(SPACE_PATTERN).filter(Boolean)
      if (!command) {
        await openPulsesGui(pi, ctx, options)
        return
      }
      if (command === 'run') {
        await runPulse(options.pulseRuntime, rest.join(' ').trim(), ctx)
        return
      }
      ctx.ui.notify(usage(), 'warning')
    },
  })
}
