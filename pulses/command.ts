import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { PulseDefinition } from './definitions.js'
import type { PulseRuntime } from './runtime.js'

const SPACE_PATTERN = /\s+/u

function usage(): string {
  return ['Usage:', '/pulse list', '/pulse run <pulse-id|owner:pulse-id|title>'].join('\n')
}

function renderPulseList(pulses: PulseDefinition[]): string {
  if (pulses.length === 0) return 'No enabled pulses found.'
  return pulses
    .map(
      (pulse) => `- ${pulse.key} — ${pulse.title} (${pulse.scheduleText}, ${pulse.relativeFile})`,
    )
    .join('\n')
}

async function listPulses(pi: ExtensionAPI, runtime: PulseRuntime): Promise<void> {
  pi.sendMessage({
    customType: 'claw-dim',
    content: renderPulseList(await runtime.list()),
    display: true,
  })
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

export function registerPulseCommand(pi: ExtensionAPI, runtime: PulseRuntime): void {
  pi.registerCommand('pulse', {
    description: 'List or run Clawa pulse definitions',
    handler: async (args, ctx) => {
      const [command, ...rest] = (args ?? '').trim().split(SPACE_PATTERN).filter(Boolean)
      if (!command || command === 'list') {
        await listPulses(pi, runtime)
        return
      }
      if (command === 'run') {
        await runPulse(runtime, rest.join(' ').trim(), ctx)
        return
      }
      ctx.ui.notify(usage(), 'warning')
    },
  })
}
