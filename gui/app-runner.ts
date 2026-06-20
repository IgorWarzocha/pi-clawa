import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import {
  about,
  back,
  backtab,
  create,
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
  slash,
  tab,
  text,
  up,
} from '../gui-primitives.js'

type AppState<Screen extends string> = {
  screen: Screen
  prev: Screen
  query: string
  search: boolean
  detail: Primitive | undefined
}

type AppContext<Screen extends string> = {
  cfg: RunAppConfig<Screen>
  state: AppState<Screen>
  primitive: () => Primitive
  slot: () => ReturnType<Primitive['slot']>
  setScreen: (screen: Screen) => void
  applySearch: () => void
  route: (intent: Intent | undefined) => void
  requestRender: () => void
  done: () => void
}

function createAppState<Screen extends string>(initial: Screen): AppState<Screen> {
  return { screen: initial, prev: initial, query: '', search: false, detail: undefined }
}

function top<Screen extends string>(app: AppContext<Screen>): boolean {
  return app.slot().tier === 'top'
}

function cycleScreen<Screen extends string>(app: AppContext<Screen>, direction: 1 | -1): Screen {
  const idx = app.cfg.cycle.indexOf(app.state.screen)
  if (idx < 0) return app.cfg.cycle[0] ?? app.state.screen
  const next = app.cfg.cycle[(idx + direction + app.cfg.cycle.length) % app.cfg.cycle.length]
  return next ?? app.state.screen
}

function handleSearchInput<Screen extends string>(app: AppContext<Screen>, data: string): boolean {
  if (!app.state.search) return false
  if (esc(data)) {
    app.state.search = false
    app.state.query = ''
    app.applySearch()
  } else if (enter(data)) {
    app.state.search = false
  } else if (back(data)) {
    app.state.query = app.state.query.slice(0, -1)
    app.applySearch()
  } else if (text(data)) {
    app.state.query += data
    app.applySearch()
  } else return true
  app.requestRender()
  return true
}

function handleDetailScroll<Screen extends string>(app: AppContext<Screen>, data: string): boolean {
  const step = detailScroll(data)
  if (!app.state.detail || step === 0) return false
  if (step > 0) app.state.detail.down()
  if (step < 0) app.state.detail.up()
  app.requestRender()
  return true
}

function handleEscape<Screen extends string>(app: AppContext<Screen>, data: string): boolean {
  if (!esc(data)) return false
  if (app.slot().tier === 'nested') {
    app.setScreen(app.state.prev)
    app.requestRender()
    return true
  }
  app.done()
  return true
}

function handleTopNavigation<Screen extends string>(
  app: AppContext<Screen>,
  data: string,
): boolean {
  const slot = app.slot()
  if (app.primitive().search() && slash(data)) {
    app.state.search = true
    app.state.query = ''
    app.applySearch()
  } else if (top(app) && about(data)) {
    app.state.prev = app.state.screen
    app.setScreen(app.cfg.about)
  } else if (top(app) && help(data)) {
    app.state.prev = app.state.screen
    app.setScreen(app.cfg.help)
  } else if (tab(data) && slot.tab) {
    app.setScreen(cycleScreen(app, 1))
  } else if (backtab(data) && slot.tab) {
    app.setScreen(cycleScreen(app, -1))
  } else return false
  app.requestRender()
  return true
}

function handlePrimitiveInput<Screen extends string>(
  app: AppContext<Screen>,
  data: string,
): boolean {
  const current = app.primitive()
  if (down(data)) current.down()
  else if (up(data)) current.up()
  else if (detailToggle(data)) {
    if (app.state.detail) app.state.detail = undefined
    else if (current.hasView()) app.route(current.view())
  } else if (enter(data)) app.route(current.enter())
  else return false
  app.requestRender()
  return true
}

function buildAppContext<Screen extends string>(
  cfg: RunAppConfig<Screen>,
  requestRender: () => void,
  done: () => void,
): AppContext<Screen> {
  const state = createAppState(cfg.initial)
  const primitive = (): Primitive => cfg.registry[state.screen]
  const slot = () => primitive().slot()
  const setScreen = (screen: Screen) => {
    state.screen = screen
    state.search = false
    state.query = ''
    const next = primitive()
    if (next.search()) next.set('')
  }
  const applySearch = () => {
    const current = primitive()
    if (current.search()) current.set(state.query)
  }
  const route = (intent: Intent | undefined) => {
    if (!intent) return
    if (intent.type === 'screen') {
      state.prev = state.screen
      setScreen(intent.screen as Screen)
      return
    }
    if (intent.type === 'detail') state.detail = cfg.details[intent.key]
    if (intent.type === 'action' && intent.run) {
      const run = intent.run
      if (intent.close) {
        done()
        setTimeout(run, 0)
        return
      }
      run()
    }
  }
  return { cfg, state, primitive, slot, setScreen, applySearch, route, requestRender, done }
}

function handleAppInput<Screen extends string>(app: AppContext<Screen>, data: string): void {
  if (handleSearchInput(app, data)) return
  if (handleDetailScroll(app, data)) return
  if (handleEscape(app, data)) return
  if (handleTopNavigation(app, data)) return
  handlePrimitiveInput(app, data)
}

export async function runClawApp<Screen extends string>(
  ctx: ExtensionCommandContext,
  cfg: RunAppConfig<Screen>,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const app = buildAppContext(cfg, () => tui.requestRender(), done)
    return {
      render: (width) => {
        const base = create(app.slot(), theme).render(width)
        if (!app.state.detail) return base
        const topbox = renderDetail(app.state.detail.slot(), width, base.length, theme)
        return [...topbox, '', ...base]
      },
      invalidate: () => {},
      handleInput: (data) => handleAppInput(app, data),
    }
  })
}
