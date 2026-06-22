import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { publishClawasOutboundMessage } from './comms/outbound.js'
import type { ClawasRuntime } from './runtime.js'
import type { WorkerState } from './types.js'

const NUMBERED_TARGET = /^\d+$/u
const SPACE = /\s+/u

type SteerTarget = {
  worker: WorkerState
  message: string
}

function splitCommand(args: string): string[] {
  return args.trim().split(SPACE).filter(Boolean)
}

function resolveSteerTarget(runtime: ClawasRuntime, args: string): SteerTarget | string {
  const trimmed = args.trim()
  if (!trimmed) return 'Usage: /steer [slot|worker] <message>'

  const parts = splitCommand(trimmed)
  const first = parts[0]
  if (!first) return 'Usage: /steer [slot|worker] <message>'

  if (NUMBERED_TARGET.test(first)) {
    const slot = Number(first)
    const worker = runtime.getMonitorWorkerBySlot(slot)
    if (!worker) return `No claw in widget slot ${slot}.`
    const message = trimmed.slice(first.length).trim()
    if (!message) return `Usage: /steer ${slot} <message>`
    return { worker, message }
  }

  const namedWorker = runtime.findMonitorWorker(first)
  if (namedWorker && parts.length > 1) {
    return { worker: namedWorker, message: parts.slice(1).join(' ') }
  }

  const activeWorker = runtime.getActiveMonitorWorker()
  if (!activeWorker) return 'No Clawas workers are available to steer.'
  return { worker: activeWorker, message: trimmed }
}

function resolveJumpTarget(runtime: ClawasRuntime, args: string): WorkerState | string {
  const trimmed = args.trim()
  if (!trimmed) {
    const activeWorker = runtime.getActiveMonitorWorker()
    return activeWorker ?? 'No Clawas workers are available to jump into.'
  }

  const parts = splitCommand(trimmed)
  if (parts.length !== 1) return 'Usage: /jump [slot|worker]'

  const target = parts[0]
  if (!target) return 'Usage: /jump [slot|worker]'

  if (NUMBERED_TARGET.test(target)) {
    const slot = Number(target)
    return runtime.getMonitorWorkerBySlot(slot) ?? `No claw in widget slot ${slot}.`
  }

  return runtime.findMonitorWorker(target) ?? `Unknown claw: ${target}`
}

export function registerSteerCommand(pi: ExtensionAPI, runtime: ClawasRuntime): void {
  pi.registerCommand('steer', {
    description:
      'Send a private steer note to the active Clawas claw, or to /steer <slot> <message>',
    handler: async (args, ctx) => {
      const target = resolveSteerTarget(runtime, args ?? '')
      if (typeof target === 'string') {
        ctx.ui.notify(target, 'warning')
        return
      }

      runtime.selectMonitorWorker(target.worker.definition.id)
      try {
        await runtime.sendPrompt(target.worker.definition.id, target.message, 'steer')
        publishClawasOutboundMessage(
          pi,
          runtime.getClawaDefaults(),
          target.worker.definition,
          target.message,
          'steer',
          runtime.getClawaDefaults().humanName,
        )
        ctx.ui.notify(`Steered ${target.worker.definition.title}.`, 'info')
      } catch (error) {
        ctx.ui.notify(
          `Failed to steer ${target.worker.definition.title}: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
      }
    },
  })
}

export function registerJumpCommand(pi: ExtensionAPI, runtime: ClawasRuntime): void {
  pi.registerCommand('jump', {
    description: 'Open the active Clawas claw in a manual panel, or /jump <slot|worker>',
    handler: async (args, ctx) => {
      const target = resolveJumpTarget(runtime, args ?? '')
      if (typeof target === 'string') {
        ctx.ui.notify(target, 'warning')
        return
      }

      runtime.selectMonitorWorker(target.definition.id)
      if (!runtime.canOpenManualPanel()) {
        ctx.ui.notify(
          `${runtime.getClawaDefaults().clawasName} manual takeover requires Herdr or tmux`,
          'warning',
        )
        return
      }

      try {
        const handle = await runtime.openWorkerPanel(target.definition.id)
        const host = runtime.getManualPanelHostLabel() ?? 'manual'
        ctx.ui.notify(
          `Jumped into ${target.definition.title} in a ${host} panel: ${handle}`,
          'info',
        )
      } catch (error) {
        ctx.ui.notify(
          `Failed to jump into ${target.definition.title}: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        )
      }
    },
  })
}

export function registerClawasMonitorShortcuts(pi: ExtensionAPI, runtime: ClawasRuntime): void {
  pi.registerShortcut('alt+w', {
    description: 'Fold or open the Clawas monitor widget',
    handler: async () => {
      runtime.toggleMonitorFold()
    },
  })

  pi.registerShortcut('alt+q', {
    description: 'Select previous Clawas claw in the monitor widget',
    handler: async () => {
      runtime.selectRelativeMonitorWorker(-1)
    },
  })

  pi.registerShortcut('alt+e', {
    description: 'Select next Clawas claw in the monitor widget',
    handler: async () => {
      runtime.selectRelativeMonitorWorker(1)
    },
  })
}
