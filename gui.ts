import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import type { ClawasRuntime } from './clawas/runtime.js'
import { buildControlActions, runControlAction, runWorkerAction } from './gui/actions.js'
import { runClawApp } from './gui/app-runner.js'
import { buildDetails } from './gui/details.js'
import { loadClawGuiModel, matchesQuery } from './gui/model.js'
import type { ActionItem, ClawItem, CreateClawRequest, Screen } from './gui/types.js'
import {
  createAction,
  type Intent,
  type Primitive,
  type RunAppConfig,
  row,
  staticPrimitive,
} from './gui-primitives.js'

export type { CreateClawRequest } from './gui/types.js'

export async function runClawGui(
  ctx: ExtensionCommandContext,
  performBootstrap: () => Promise<import('./bootstrap.js').BootstrapResult | null>,
  performCreate: (request: CreateClawRequest) => Promise<{ name: string; path: string }>,
  runtime: ClawasRuntime,
): Promise<void> {
  const model = await loadClawGuiModel(ctx.cwd, runtime)
  let lastStatus = `${model.clawa.clawasName} ready.`
  const setStatus = (message: string) => {
    lastStatus = message
  }

  const config: RunAppConfig<Screen> = {
    registry: {
      claws: buildClawsScreen(ctx, runtime, model.clawItems, setStatus),
      manage: buildManageScreen(ctx, runtime, model, performBootstrap, performCreate, setStatus),
      about: buildAboutScreen(model),
      help: buildHelpScreen(() => lastStatus),
    },
    details: buildDetails(model),
    cycle: model.clawItems.length > 0 ? ['claws', 'manage'] : ['manage'],
    initial: model.clawItems.length > 0 ? 'claws' : 'manage',
    about: 'about',
    help: 'help',
  }

  await runClawApp(ctx, config)
}

function buildClawsScreen(
  ctx: ExtensionCommandContext,
  runtime: ClawasRuntime,
  clawItems: ClawItem[],
  setStatus: (message: string) => void,
): Primitive {
  return createAction<ClawItem>(
    {
      title: 'claw',
      items: clawItems,
      shortcuts: 'enter act • v detail • tab cycle • esc close',
      page: 7,
      find: (item, query) => matchesQuery(query, item.name, item.summary),
      intent: (item): Intent | undefined => {
        const worker = item.workers[0]
        if (!worker) return { type: 'detail', key: item.detailKey }
        void runWorkerAction(ctx, runtime, worker, setStatus)
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
}

function buildManageScreen(
  ctx: ExtensionCommandContext,
  runtime: ClawasRuntime,
  model: Awaited<ReturnType<typeof loadClawGuiModel>>,
  performBootstrap: () => Promise<import('./bootstrap.js').BootstrapResult | null>,
  performCreate: (request: CreateClawRequest) => Promise<{ name: string; path: string }>,
  setStatus: (message: string) => void,
): Primitive {
  const controlActions = buildControlActions(model)
  return createAction<ActionItem>(
    {
      title: 'claw/manage',
      items: controlActions,
      shortcuts: 'enter run • v detail • tab cycle • esc close',
      page: 7,
      find: (item, query) => matchesQuery(query, item.label, item.summary),
      intent: (item): Intent | undefined => {
        void runControlAction({
          ctx,
          item,
          runtime,
          clawasName: model.clawa.clawasName,
          performCreate,
          performBootstrap,
          setStatus,
        })
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
}

function buildAboutScreen(model: Awaited<ReturnType<typeof loadClawGuiModel>>): Primitive {
  return staticPrimitive(() => ({
    title: 'claw/about',
    content: [
      row('Unified claw console', 'accent'),
      row(''),
      row(`Main claw: ${model.clawa.mainClawName}`),
      row(`Clawas: ${model.clawa.clawasName}`),
      row(`Claw config: ${model.loaded.path}`),
      row(`Worker config: ${model.configPath}`),
      row('The main list is claw-first: one row per claw, with runtime folded in.'),
    ],
    shortcuts: 'tab cycle • esc close',
    active: [],
    tier: 'top',
    tab: true,
  }))
}

function buildHelpScreen(getStatus: () => string): Primitive {
  return staticPrimitive(() => ({
    title: 'claw/help',
    content: [
      row('Enter : act on the highlighted claw', 'accent'),
      row('Shift+J/K : scroll long detail views'),
      row('V     : toggle detail panel'),
      row('Tab   : cycle top screens'),
      row('Esc   : close'),
      row(''),
      row('No worker yet? Enter falls back to detail.'),
      row(`Status: ${getStatus()}`),
    ],
    shortcuts: 'tab cycle • esc close',
    active: [],
    tier: 'top',
    tab: true,
  }))
}
