import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { BootstrapResult } from '../bootstrap.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import { runComposer, runPicker } from '../gui-primitives.js'
import type { ClawGuiModel } from './model.js'
import type { ActionItem, CreateClawAction, ManagedWorker, WorkerAction } from './types.js'

export function buildControlActions(model: ClawGuiModel): ActionItem[] {
  const actions: ActionItem[] = [
    {
      label: 'new claw',
      summary: 'Create and register another claw',
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
    title: 'Create claw',
    placeholder: 'Enter the new claw name...',
    maxLines: 1,
    maxLength: 120,
  })
  if (!name?.trim()) return

  const created = await performCreate({ name: name.trim() })
  const status = `Created ${created.name} at ${created.path}. Reopen /claw to refresh the list.`
  setStatus(status)
  ctx.ui.notify(status, 'info')
}
