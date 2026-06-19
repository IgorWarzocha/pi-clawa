import { createDetail, type Primitive } from '../gui-primitives.js'
import type { ClawGuiModel } from './model.js'
import type { ClawItem } from './types.js'

export function buildDetails(model: ClawGuiModel): Record<string, Primitive> {
  const details: Record<string, Primitive> = {
    bootstrap: createDetail({
      title: 'bootstrap-workspace',
      meta: [
        'copies bundled templates into the current working directory',
        'writes .pi/claw.json with bootstrapped=true',
        'writes the main claw continuity files before startup',
      ],
      body: [
        'Files: AGENTS.md, CLAW.md, HUMAN.md, CLAWAS.md, TOOLS.md, CURIOUS.md',
        'AGENTS.md is not injected by claw hydration (Pi already handles AGENTS).',
      ],
    }),
    'create-claw': createDetail({
      title: 'create-clawa',
      meta: [
        `creates a visible Clawa home under ${model.loaded.config.clawas.baseDir}`,
        'bootstraps it with starter worker files and shared HUMAN/CLAWAS links',
        'registers it as a Clawas worker seed',
      ],
      body: [
        'You will be asked for the purpose, not a final name.',
        'The main Clawa and new Clawa should shape the lane, docs, name, and toolkit afterwards.',
      ],
    }),
    'restart-clawas': createDetail({
      title: 'restart-clawas',
      meta: [`restarts the ${model.clawa.clawasName} daemon and managed workers`],
      body: ['Useful after config edits, UI changes, or when a worker gets wedged.'],
    }),
  }

  for (const item of model.clawItems) {
    details[item.detailKey] = buildClawDetail(item)
  }
  return details
}

function buildClawDetail(item: ClawItem): Primitive {
  return createDetail({
    title: item.name,
    meta: buildClawMeta(item),
    body: buildClawBody(item),
  })
}

function yesNo(value: boolean): 'yes' | 'no' {
  return value ? 'yes' : 'no'
}

function buildClawMeta(item: ClawItem): string[] {
  const worker = item.workers[0]
  return [
    `path: ${item.config.path}`,
    `absolute: ${item.status.absPath}`,
    `autostart: ${yesNo(item.config.autostart === true)}`,
    `exists: ${yesNo(item.status.exists)}`,
    `bootstrapped: ${yesNo(item.status.bootstrapped)}`,
    `managed worker: ${yesNo(Boolean(worker))}`,
    `worker status: ${worker?.status ?? 'not configured'}`,
    `manual: ${yesNo(worker?.manualSession === true)} (/jump to open)`,
  ]
}

function buildClawBody(item: ClawItem): string[] {
  const worker = item.workers[0]
  return [
    item.config.notes ? `notes: ${item.config.notes}` : 'notes: (none)',
    `socket: ${item.status.socketPath ?? '(none)'}`,
    `session file: ${worker?.sessionFile ?? '(none)'}`,
    `worker id: ${worker?.id ?? '(none)'}`,
    `worker cwd: ${worker?.cwd ?? '(none)'}`,
    `model: ${worker?.model ?? 'default'}`,
    `thinking: ${worker?.thinking ?? 'default'}`,
    `current task: ${worker?.currentTask ?? '(none)'}`,
    `last summary: ${worker?.lastSummary ?? '(none)'}`,
    `last error: ${worker?.lastError ?? '(none)'}`,
    formatExtraWorkers(item),
  ]
}

function formatExtraWorkers(item: ClawItem): string {
  if (item.workers.length <= 1) return 'extra workers: (none)'
  const extraWorkers = item.workers
    .slice(1)
    .map((extra) => `${extra.title} (${extra.id})`)
    .join(', ')
  return `extra workers: ${extraWorkers}`
}
