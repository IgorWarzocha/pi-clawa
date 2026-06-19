import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { BootstrapResult } from './bootstrap'
import { resolveSocketPath } from './clawas/comms/paths.js'
import { getClawasConfigPath, loadClawasConfig } from './clawas/config-loader.js'
import type { ClawasRuntime } from './clawas/runtime.js'
import type { WorkerDefinition, WorkerState, WorkerThinkingLevel } from './clawas/types.js'
import {
  type ClawaConfig,
  findRepoRoot,
  loadClawEnvironmentConfig,
  resolveClawaDefaults,
} from './config'
import {
  about,
  back,
  backtab,
  create,
  createAction,
  createDetail,
  detailScroll,
  detailToggle,
  down,
  enter,
  esc,
  help,
  type Intent,
  type Primitive,
  type RunAppConfig,
  renderDetail,
  row,
  runComposer,
  runPicker,
  slash,
  staticPrimitive,
  tab,
  text,
  up,
} from './gui-primitives.js'
import { hasAllCoreMarkdownFiles } from './template-files.js'

interface ActionItem {
  label: string
  summary: string
  detailKey: string
  kind: 'bootstrap' | 'create' | 'restart'
}

interface ManagedWorker {
  id: string
  title: string
  cwd: string
  status: WorkerState['status']
  manualSession: boolean
  autostart: boolean
  model?: string
  thinking?: WorkerThinkingLevel
  currentTask?: string
  lastSummary?: string
  lastError?: string
  sessionFile?: string
}

interface ClawItem {
  name: string
  summary: string
  detailKey: string
  status: ClawStatus
  config: ClawaConfig
  workers: ManagedWorker[]
}

type Screen = 'claws' | 'manage' | 'about' | 'help'

type WorkerAction = 'prompt' | 'steer'

export interface CreateClawRequest {
  name: string
}

interface ClawStatus {
  absPath: string
  exists: boolean
  bootstrapped: boolean
  live: boolean
  socketPath: string | null
}

async function getClawStatus(repoRoot: string, claw: ClawaConfig): Promise<ClawStatus> {
  const absPath = resolve(repoRoot, claw.path)
  const exists = existsSync(absPath)
  const bootstrapped = exists ? hasAllCoreMarkdownFiles(absPath) : false
  const socketPath = await resolveSocketPath(claw.name)
  return {
    absPath,
    exists,
    bootstrapped,
    live: Boolean(socketPath),
    socketPath,
  }
}

function matchesQuery(query: string, ...parts: string[]): boolean {
  return parts.join(' ').toLowerCase().includes(query.toLowerCase())
}

function summarizeWorker(worker: ManagedWorker): string {
  const bits: string[] = [worker.status]
  if (worker.manualSession) bits.push('manual')
  if (worker.currentTask) bits.push(worker.currentTask)
  else if (worker.lastSummary) bits.push(worker.lastSummary)
  return bits.join(' • ')
}

function summarizeClaw(
  claw: ClawaConfig,
  status: ClawStatus,
  worker: ManagedWorker | undefined,
  extraWorkers: number,
): string {
  const bits = [worker ? summarizeWorker(worker) : 'no runner yet']
  if (!status.exists) bits.push('folder missing')
  else if (!status.bootstrapped) bits.push('not bootstrapped')
  if (extraWorkers > 0) bits.push(`+${extraWorkers} more`)
  if (claw.notes) bits.push(claw.notes)
  return bits.join(' • ')
}

function bindWorker(
  repoRoot: string,
  definition: WorkerDefinition,
  liveWorker: WorkerState | undefined,
): { absCwd: string; worker: ManagedWorker } {
  return {
    absCwd: resolve(repoRoot, definition.cwd),
    worker: {
      id: definition.id,
      title: definition.title,
      cwd: definition.cwd,
      status: liveWorker?.status ?? 'stopped',
      manualSession: liveWorker?.manualSession === true,
      autostart: definition.autostart,
      model: definition.model,
      thinking: definition.thinking,
      currentTask: liveWorker?.currentTask,
      lastSummary: liveWorker?.lastSummary,
      lastError: liveWorker?.lastError,
      sessionFile: liveWorker?.sessionFile,
    },
  }
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

async function runWorkerAction(
  ctx: ExtensionCommandContext,
  runtime: ClawasRuntime,
  worker: ManagedWorker,
  setStatus: (message: string) => void,
): Promise<void> {
  const action = await runWorkerActionPicker(ctx, worker)
  if (!action) return

  if (action === 'prompt' || action === 'steer') {
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
    return
  }
}

async function runClawApp<Screen extends string>(
  ctx: ExtensionCommandContext,
  cfg: RunAppConfig<Screen>,
): Promise<void> {
  const state = {
    screen: cfg.initial,
    prev: cfg.initial,
    query: '',
    search: false,
    detail: undefined as Primitive | undefined,
  }

  const primitive = (): Primitive => cfg.registry[state.screen]
  const slot = () => primitive().slot()
  const top = () => slot().tier === 'top'
  const setScreen = (screen: Screen) => {
    state.screen = screen
    state.search = false
    state.query = ''
    const next = primitive()
    if (next.search()) {
      next.set('')
    }
  }
  const apply = () => {
    const current = primitive()
    if (current.search()) {
      current.set(state.query)
    }
  }
  const route = (intent: Intent | undefined) => {
    if (!intent) return
    if (intent.type === 'screen') {
      state.prev = state.screen
      setScreen(intent.screen as Screen)
      return
    }
    if (intent.type === 'detail') {
      const target = cfg.details[intent.key]
      if (target) {
        state.detail = target
      }
    }
  }

  await ctx.ui.custom<void>((tui, theme, _keys, done) => ({
    render: (width) => {
      const base = create(slot(), theme).render(width)
      if (!state.detail) {
        return base
      }
      const topbox = renderDetail(state.detail.slot(), width, base.length, theme)
      return [...topbox, '', ...base]
    },
    invalidate: () => {},
    handleInput: (data) => {
      if (state.search) {
        if (esc(data)) {
          state.search = false
          state.query = ''
          apply()
          tui.requestRender()
          return
        }
        if (enter(data)) {
          state.search = false
          tui.requestRender()
          return
        }
        if (back(data)) {
          state.query = state.query.slice(0, -1)
          apply()
          tui.requestRender()
          return
        }
        if (text(data)) {
          state.query += data
          apply()
          tui.requestRender()
        }
        return
      }

      const step = detailScroll(data)
      if (state.detail && step !== 0) {
        if (step > 0) state.detail.down()
        if (step < 0) state.detail.up()
        tui.requestRender()
        return
      }

      if (esc(data)) {
        if (slot().tier === 'nested') {
          setScreen(state.prev)
          tui.requestRender()
          return
        }
        done()
        return
      }

      const current = primitive()
      if (current.search() && slash(data)) {
        state.search = true
        state.query = ''
        apply()
        tui.requestRender()
        return
      }
      if (top() && about(data)) {
        state.prev = state.screen
        setScreen(cfg.about)
        tui.requestRender()
        return
      }
      if (top() && help(data)) {
        state.prev = state.screen
        setScreen(cfg.help)
        tui.requestRender()
        return
      }
      if (tab(data) && slot().tab) {
        const idx = cfg.cycle.indexOf(state.screen)
        const next = idx < 0 ? 0 : (idx + 1) % cfg.cycle.length
        setScreen(cfg.cycle[next]!)
        tui.requestRender()
        return
      }
      if (backtab(data) && slot().tab) {
        const idx = cfg.cycle.indexOf(state.screen)
        const prev = idx < 0 ? 0 : (idx - 1 + cfg.cycle.length) % cfg.cycle.length
        setScreen(cfg.cycle[prev]!)
        tui.requestRender()
        return
      }
      if (down(data)) {
        current.down()
        tui.requestRender()
        return
      }
      if (up(data)) {
        current.up()
        tui.requestRender()
        return
      }
      if (detailToggle(data)) {
        if (state.detail) {
          state.detail = undefined
          tui.requestRender()
          return
        }
        if (current.hasView()) {
          route(current.view())
          tui.requestRender()
        }
        return
      }
      if (enter(data)) {
        route(current.enter())
        tui.requestRender()
      }
    },
  }))
}

export async function runClawGui(
  ctx: ExtensionCommandContext,
  performBootstrap: () => Promise<BootstrapResult | null>,
  performCreate: (request: CreateClawRequest) => Promise<{ name: string; path: string }>,
  runtime: ClawasRuntime,
): Promise<void> {
  const repoRoot = findRepoRoot(ctx.cwd)
  const clawa = resolveClawaDefaults(repoRoot)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const clawasConfig = await loadClawasConfig(repoRoot)
  const configPath = getClawasConfigPath(repoRoot)
  const claws = loaded.config.clawas.claws
  const clawStatuses = await Promise.all(claws.map((claw) => getClawStatus(repoRoot, claw)))
  const currentWorkspaceBootstrapped = loaded.config.bootstrapped === true
  const liveWorkers = new Map(
    (runtime.getState()?.workers ?? []).map((worker) => [worker.definition.id, worker]),
  )
  const workersByCwd = new Map<string, ManagedWorker[]>()
  for (const definition of clawasConfig?.workers ?? []) {
    const binding = bindWorker(repoRoot, definition, liveWorkers.get(definition.id))
    const existing = workersByCwd.get(binding.absCwd) ?? []
    existing.push(binding.worker)
    workersByCwd.set(binding.absCwd, existing)
  }
  let lastStatus = `${clawa.clawasName} ready.`

  const clawItems: ClawItem[] = claws.map((claw, index) => {
    const status = clawStatuses[index]
    const workers = workersByCwd.get(status.absPath) ?? []
    const primaryWorker = workers[0]
    return {
      name: claw.name,
      summary: summarizeClaw(claw, status, primaryWorker, Math.max(0, workers.length - 1)),
      detailKey: `claw:${claw.name}`,
      status,
      config: claw,
      workers,
    }
  })
  const details: Record<string, Primitive> = {}

  const controlActions: ActionItem[] = [
    {
      label: 'new claw',
      summary: 'Create and register another claw',
      detailKey: 'create-claw',
      kind: 'create',
    },
    {
      label: 'restart clawas',
      summary: `Restart the ${clawa.clawasName} daemon`,
      detailKey: 'restart-clawas',
      kind: 'restart',
    },
  ]
  if (!currentWorkspaceBootstrapped) {
    controlActions.push({
      label: 'bootstrap here',
      summary: 'Set up this workspace with claw docs and hydration files',
      detailKey: 'bootstrap',
      kind: 'bootstrap',
    })
  }

  const clawsScreen = createAction<ClawItem>(
    {
      title: 'claw',
      items: clawItems,
      shortcuts: 'enter act • v detail • tab cycle • esc close',
      page: 7,
      find: (item, query) => matchesQuery(query, item.name, item.summary),
      intent: (item): Intent | undefined => {
        const worker = item.workers[0]
        if (!worker) {
          return { type: 'detail', key: item.detailKey }
        }

        void runWorkerAction(ctx, runtime, worker, (message) => {
          lastStatus = message
        })
        return undefined
      },
      view: (item): Intent => ({ type: 'detail', key: item.detailKey }),
      cols: [
        {
          show: true,
          width: 22,
          tone: 'accent',
          align: 'left',
          pick: (item) => item.name,
        },
        {
          show: true,
          width: 58,
          tone: 'dim',
          align: 'left',
          pick: (item) => item.summary,
        },
      ],
    },
    'top',
  )

  const manage = createAction<ActionItem>(
    {
      title: 'claw/manage',
      items: controlActions,
      shortcuts: 'enter run • v detail • tab cycle • esc close',
      page: 7,
      find: (item, query) => matchesQuery(query, item.label, item.summary),
      intent: (item): Intent | undefined => {
        void (async () => {
          if (item.kind === 'create') {
            const name = await runComposer(ctx, {
              title: 'Create claw',
              placeholder: 'Enter the new claw name...',
              maxLines: 1,
              maxLength: 120,
            })
            if (!name?.trim()) return

            const created = await performCreate({ name: name.trim() })
            lastStatus = `Created ${created.name} at ${created.path}. Reopen /claw to refresh the list.`
            ctx.ui.notify(lastStatus, 'info')
            return
          }

          if (item.kind === 'restart') {
            await runtime.restart()
            lastStatus = `${clawa.clawasName} daemon restarted.`
            ctx.ui.notify(lastStatus, 'info')
            return
          }

          const result = await performBootstrap()
          if (!result) return
          lastStatus = `Bootstrap done: ${result.created} created, ${result.overwritten} overwritten.`
          ctx.ui.notify(lastStatus, 'info')
        })()
        return undefined
      },
      view: (item): Intent => ({ type: 'detail', key: item.detailKey }),
      cols: [
        {
          show: true,
          width: 24,
          tone: 'accent',
          align: 'left',
          pick: (item) => item.label,
        },
        {
          show: true,
          width: 54,
          tone: 'dim',
          align: 'left',
          pick: (item) => item.summary,
        },
      ],
    },
    'top',
  )

  Object.assign(details, {
    bootstrap: createDetail({
      title: 'bootstrap-workspace',
      meta: [
        'copies bundled templates into the current working directory',
        'writes .pi/claw.json with bootstrapped=true',
        'writes the main claw continuity files before startup',
      ],
      body: [
        'Files: AGENTS.md, CLAW.md, HUMAN.md, TOOLS.md, CURIOUS.md, PRIVACY.md',
        'AGENTS.md is not injected by claw hydration (Pi already handles AGENTS).',
      ],
    }),
    'create-claw': createDetail({
      title: 'create-claw',
      meta: [
        `creates a new claw workspace under ${loaded.config.clawas.baseDir}`,
        'bootstraps it with the bundled main claw templates',
        'registers it in claw config for monitoring',
      ],
      body: [
        'You will be asked for the claw name.',
        'The claw folder path is tied automatically from config baseDir + name.',
      ],
    }),
    'restart-clawas': createDetail({
      title: 'restart-clawas',
      meta: [`restarts the ${clawa.clawasName} daemon and managed workers`],
      body: ['Useful after config edits, UI changes, or when a worker gets wedged.'],
    }),
  })

  for (const item of clawItems) {
    const worker = item.workers[0]
    details[item.detailKey] = createDetail({
      title: item.name,
      meta: [
        `path: ${item.config.path}`,
        `absolute: ${item.status.absPath}`,
        `autostart: ${item.config.autostart === true ? 'yes' : 'no'}`,
        `exists: ${item.status.exists ? 'yes' : 'no'}`,
        `bootstrapped: ${item.status.bootstrapped ? 'yes' : 'no'}`,
        `managed worker: ${worker ? 'yes' : 'no'}`,
        `worker status: ${worker?.status ?? 'not configured'}`,
        `manual: ${worker?.manualSession ? 'yes' : 'no'} (/jump to open)`,
      ],
      body: [
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
        item.workers.length > 1
          ? `extra workers: ${item.workers
              .slice(1)
              .map((extra) => `${extra.title} (${extra.id})`)
              .join(', ')}`
          : 'extra workers: (none)',
      ],
    })
  }

  const about = staticPrimitive(() => ({
    title: 'claw/about',
    content: [
      row('Unified claw console', 'accent'),
      row(''),
      row(`Main claw: ${clawa.mainClawName}`),
      row(`Clawas: ${clawa.clawasName}`),
      row(`Claw config: ${loaded.path}`),
      row(`Worker config: ${configPath}`),
      row('The main list is claw-first: one row per claw, with runtime folded in.'),
    ],
    shortcuts: 'tab cycle • esc close',
    active: [],
    tier: 'top',
    tab: true,
  }))

  const help = staticPrimitive(() => ({
    title: 'claw/help',
    content: [
      row('Enter : act on the highlighted claw', 'accent'),
      row('Shift+J/K : scroll long detail views'),
      row('V     : toggle detail panel'),
      row('Tab   : cycle top screens'),
      row('Esc   : close'),
      row(''),
      row('No worker yet? Enter falls back to detail.'),
      row(`Status: ${lastStatus}`),
    ],
    shortcuts: 'tab cycle • esc close',
    active: [],
    tier: 'top',
    tab: true,
  }))

  const registry: Record<Screen, Primitive> = {
    claws: clawsScreen,
    manage,
    about,
    help,
  }
  const cycle: Screen[] = clawItems.length > 0 ? ['claws', 'manage'] : ['manage']

  const config: RunAppConfig<Screen> = {
    registry,
    details,
    cycle,
    initial: cycle[0] ?? 'manage',
    about: 'about',
    help: 'help',
  }

  await runClawApp(ctx, config)
}
