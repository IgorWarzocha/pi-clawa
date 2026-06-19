import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { publishClawasOutboundMessage } from './comms/outbound.js'
import type { ClawasRuntime } from './runtime.js'

// NOTE: This slash-command surface is intentionally unwired right now.
// The live clawas surface is the tool/comms path, not `/clawas ...`.
// Keep this file as parked code only until the command lane is explicitly re-enabled.
// Do not document these commands as current user-facing controls.

function splitCommand(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean)
}

export function registerClawasCommands(pi: ExtensionAPI, runtime: ClawasRuntime): void {
  pi.registerCommand('clawas', {
    description: 'Control the Clawas daemon',
    handler: async (args, ctx) => {
      const clawasName = runtime.getClawaDefaults().clawasName
      const parts = splitCommand(args)
      const command = parts[0] ?? 'status'

      if (command === 'status') {
        const workers = runtime.getWorkerIds()
        ctx.ui.notify(
          workers.length > 0
            ? `${clawasName} daemon live. Workers: ${workers.join(', ')}`
            : `${clawasName} daemon has not started any workers yet.`,
          'info',
        )
        return
      }

      if (command === 'reset' || command === 'restart') {
        try {
          await runtime.restart()
          ctx.ui.notify(`${clawasName} daemon restarted.`, 'info')
        } catch (error) {
          ctx.ui.notify(
            `Failed to restart ${clawasName} daemon: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }

      if (command === 'send') {
        const workerId = parts[1]
        const message = parts.slice(2).join(' ')
        if (!(workerId && message)) {
          ctx.ui.notify('Usage: /clawas send <worker> <message>', 'warning')
          return
        }
        try {
          await runtime.sendPrompt(workerId, message, 'prompt')
          publishClawasOutboundMessage(
            pi,
            runtime.getClawaDefaults(),
            runtime.getWorkerDefinition(workerId),
            message,
            'prompt',
          )
          ctx.ui.notify(`Sent prompt to ${workerId}.`, 'info')
        } catch (error) {
          ctx.ui.notify(
            `Failed to send prompt to ${workerId}: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }

      if (command === 'steer') {
        const workerId = parts[1]
        const message = parts.slice(2).join(' ')
        if (!(workerId && message)) {
          ctx.ui.notify('Usage: /clawas steer <worker> <message>', 'warning')
          return
        }
        try {
          await runtime.sendPrompt(workerId, message, 'steer')
          publishClawasOutboundMessage(
            pi,
            runtime.getClawaDefaults(),
            runtime.getWorkerDefinition(workerId),
            message,
            'steer',
          )
          ctx.ui.notify(`Sent steer to ${workerId}.`, 'info')
        } catch (error) {
          ctx.ui.notify(
            `Failed to steer ${workerId}: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }

      if (command === 'open' || command === 'panel') {
        const workerId = parts[1]
        if (!workerId) {
          ctx.ui.notify('Usage: /clawas open <worker>', 'warning')
          return
        }
        try {
          const handle = await runtime.openWorkerPanel(workerId)
          ctx.ui.notify(`Opened ${workerId} (${handle}).`, 'info')
        } catch (error) {
          ctx.ui.notify(
            `Failed to open ${workerId}: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }

      if (command === 'window') {
        const workerId = parts[1]
        if (!workerId) {
          ctx.ui.notify('Usage: /clawas window <worker>', 'warning')
          return
        }
        try {
          const handle = await runtime.openWorkerWindow(workerId)
          ctx.ui.notify(`Opened ${workerId} (${handle}).`, 'info')
        } catch (error) {
          ctx.ui.notify(
            `Failed to open ${workerId}: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }

      ctx.ui.notify(`Unknown ${clawasName} command: ${args}`, 'warning')
    },
  })
}
