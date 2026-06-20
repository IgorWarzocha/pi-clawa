import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { BootstrapResult } from '../bootstrap.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import { runComposer, runPicker } from '../gui-primitives.js'
import type { PulseRuntime } from '../pulses/runtime.js'
import type { ClawGuiModel } from './model.js'
import type {
  ActionItem,
  CreateClawAction,
  ManagedWorker,
  PulseItem,
  WorkerAction,
} from './types.js'

export function buildControlActions(model: ClawGuiModel): ActionItem[] {
  const actions: ActionItem[] = [
    {
      label: 'create clawa',
      summary: 'Seed a specialized Clawa from a purpose prompt',
      detailKey: 'create-claw',
      kind: 'create',
    },
    {
      label: 'restart clawas',
      summary: `Restart the ${model.clawa.clawasName} daemon`,
      detailKey: 'restart-clawas',
      kind: 'restart',
    },
  ]
  if (!model.currentWorkspaceBootstrapped) {
    actions.push({
      label: 'bootstrap here',
      summary: 'Set up this workspace with claw docs and hydration files',
      detailKey: 'bootstrap',
      kind: 'bootstrap',
    })
  }
  return actions
}

async function runWorkerActionPicker(
  ctx: ExtensionCommandContext,
  worker: ManagedWorker,
): Promise<WorkerAction | undefined> {
  return await runPicker<WorkerAction>(ctx, {
    title: `${worker.title} actions`,
    items: [
      {
        label: 'Send note',
        value: 'prompt',
        searchableText: 'message prompt send note',
      },
      {
        label: 'Steer ongoing work',
        value: 'steer',
        searchableText: 'steer follow up',
      },
      {
        label: 'Jump into manual panel',
        value: 'jump',
        searchableText: 'jump manual panel takeover',
      },
    ],
    search: false,
    page: 7,
  })
}

export async function runWorkerAction(
  ctx: ExtensionCommandContext,
  runtime: ClawasRuntime,
  worker: ManagedWorker,
  setStatus: (message: string) => void,
): Promise<void> {
  const action = await runWorkerActionPicker(ctx, worker)
  if (!action) return

  if (action === 'jump') {
    const handle = await runtime.openWorkerPanel(worker.id)
    const host = runtime.getManualPanelHostLabel() ?? 'manual'
    const status = `Jumped into ${worker.title} in a ${host} panel: ${handle}`
    setStatus(status)
    ctx.ui.notify(status, 'info')
    return
  }

  const message = await runComposer(ctx, {
    title: `${worker.title}: ${action === 'prompt' ? 'send note' : 'steer work'}`,
    placeholder: 'Write your note...',
    maxLines: 40,
    maxLength: 12000,
  })
  if (!message?.trim()) return

  await runtime.sendPrompt(worker.id, message.trim(), action === 'prompt' ? 'prompt' : 'steer')
  const status = `Sent ${action} note to ${worker.title}. Reopen /claw to refresh status.`
  setStatus(status)
  ctx.ui.notify(status, 'info')
}

export async function runPulseAction(
  ctx: ExtensionCommandContext,
  runtime: PulseRuntime,
  item: PulseItem,
  setStatus: (message: string) => void,
): Promise<void> {
  try {
    const pulse = await runtime.runNow(item.key)
    const status = `Queued pulse ${pulse.title}.`
    setStatus(status)
    ctx.ui.notify(status, 'info')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setStatus(message)
    ctx.ui.notify(message, 'error')
  }
}

export async function runControlAction(options: {
  ctx: ExtensionCommandContext
  item: ActionItem
  runtime: ClawasRuntime
  clawasName: string
  performCreate: CreateClawAction
  performBootstrap: () => Promise<BootstrapResult | null>
  setStatus: (message: string) => void
}): Promise<void> {
  const { ctx, item, runtime, clawasName, performCreate, performBootstrap, setStatus } = options
  if (item.kind === 'create') {
    await runCreateAction(ctx, performCreate, setStatus)
    return
  }
  if (item.kind === 'restart') {
    await runtime.restart()
    const status = `${clawasName} daemon restarted.`
    setStatus(status)
    ctx.ui.notify(status, 'info')
    return
  }
  const result = await performBootstrap()
  if (!result) return
  const status = `Bootstrap done: ${result.created} created, ${result.overwritten} overwritten.`
  setStatus(status)
  ctx.ui.notify(status, 'info')
}

async function runCreateAction(
  ctx: ExtensionCommandContext,
  performCreate: CreateClawAction,
  setStatus: (message: string) => void,
): Promise<void> {
  const name = await runComposer(ctx, {
    title: 'Create Clawa',
    placeholder: 'What should this specialized Clawa exist to do?',
    maxLines: 8,
    maxLength: 2000,
  })
  if (!name?.trim()) return

  const created = await performCreate({ purpose: name.trim() })
  const status = `Seeded ${created.name} at ${created.path}. Reopen /claw to refresh the list.`
  setStatus(status)
  ctx.ui.notify(status, 'info')
}
