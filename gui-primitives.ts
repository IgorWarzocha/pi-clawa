import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

export type Intent =
  | { type: 'screen'; screen: string }
  | { type: 'detail'; key: string }
  | { type: 'action'; name: string }
  | { type: 'link'; url: string }

export type Tier = 'top' | 'nested'
export type Tone = 'normal' | 'dim' | 'accent'
export type Cell = { text: string; tone: Tone }
export type Line = { cells: Cell[] }
export type Slot = {
  title: string
  content: Line[]
  shortcuts: string
  active: number[]
  tier: Tier
  tab: boolean
}

type Theme = { fg: (color: string, text: string) => string }
type View = {
  render: (width: number) => string[]
  invalidate: () => void
  handleInput: (data: string) => void
}
type Ui = {
  custom: <T>(
    factory: (
      tui: { requestRender: () => void },
      theme: Theme,
      keys: unknown,
      done: (result: T) => void,
    ) => View,
  ) => Promise<T>
}
type Ctx = { hasUI: boolean; ui: Ui }

export type Primitive = {
  slot: () => Slot
  up: () => void
  down: () => void
  search: () => boolean
  set: (query: string) => void
  enter: () => Intent | undefined
  hasView: () => boolean
  view: () => Intent | undefined
}

export type RunAppConfig<Screen extends string> = {
  registry: Record<Screen, Primitive>
  details: Record<string, Primitive>
  cycle: Screen[]
  initial: Screen
  about: Screen
  help: Screen
}

export type Align = 'left' | 'right'
export type Col<T> = {
  show: boolean
  width: number
  tone: Tone
  align: Align
  pick: (item: T) => string
}
export type ListFlow = { columns: number }
export type ListOptions<T> = {
  title: string
  items: T[]
  shortcuts: string
  tier: Tier
  tab: boolean
  search: boolean
  prompt: boolean
  page: number
  find: (item: T, query: string) => boolean
  intent: (item: T) => Intent | undefined
  view?: (item: T) => Intent | undefined
  cols: Col<T>[]
  flow?: ListFlow
}
export type ActionOptions<T> = {
  title: string
  items: T[]
  shortcuts: string
  page: number
  find: (item: T, query: string) => boolean
  intent: (item: T) => Intent | undefined
  view?: (item: T) => Intent | undefined
  cols: Col<T>[]
  flow?: ListFlow
}

type PickerItem<T> = { label: string; value: T; searchableText?: string }
type PickerOptions<T> = {
  title: string
  items: PickerItem<T>[]
  search?: boolean
  page?: number
  shortcuts?: string
  match?: (item: PickerItem<T>, query: string) => boolean
}
type ComposerOptions = {
  title: string
  initial?: string
  placeholder?: string
  shortcuts?: string
  maxLines?: number
  maxLength?: number
}

const FRAME_ROWS = 15
const DETAIL_PAGE = 24
const PICKER_PAGE = 7
const COMPOSER_VISIBLE_ROWS = 6

export function esc(data: string): boolean {
  return matchesKey(data, 'escape')
}
export function tab(data: string): boolean {
  return matchesKey(data, 'tab')
}
export function backtab(data: string): boolean {
  return matchesKey(data, 'shift+tab')
}
export function enter(data: string): boolean {
  return matchesKey(data, 'enter')
}
export function down(data: string): boolean {
  return matchesKey(data, 'down') || matchesKey(data, 'j')
}
export function up(data: string): boolean {
  return matchesKey(data, 'up') || matchesKey(data, 'k')
}
export function slash(data: string): boolean {
  return data === '/'
}
export function about(data: string): boolean {
  return data === '?'
}
export function help(data: string): boolean {
  return data === 'H'
}
export function back(data: string): boolean {
  return matchesKey(data, 'backspace')
}
export function text(data: string): boolean {
  return data.length === 1 && data >= ' ' && data <= '~'
}
export function detailToggle(data: string): boolean {
  return data === 'v' || data === 'V'
}
export function detailScroll(data: string): number {
  if (data === 'J') return 1
  if (data === 'K') return -1
  return 0
}

function coloredLine(line: Line, theme: Theme): string {
  let out = ''
  for (const cell of line.cells) {
    if (cell.tone === 'dim') out += theme.fg('dim', cell.text)
    else if (cell.tone === 'accent') out += theme.fg('accent', cell.text)
    else out += cell.text
  }
  return out
}

export function row(text: string, tone: Tone = 'normal'): Line {
  return { cells: [{ text, tone }] }
}

function cut(value: string, width: number): string {
  return truncateToWidth(value, Math.max(0, width))
}
function blank(width: number): string {
  return ' '.repeat(Math.max(0, width))
}
function sep(width: number, theme: Theme): string {
  return cut(theme.fg('accent', '─'.repeat(Math.max(0, width))), width)
}
function foot(slot: Slot): string {
  if (slot.tier === 'top') {
    if (!slot.shortcuts) return 'shift+h help • ? about • esc close'
    return `${slot.shortcuts} • shift+h help • ? about • esc close`
  }
  if (!slot.shortcuts) return 'esc back'
  return `${slot.shortcuts} • esc back`
}
export function create(
  slot: Slot,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  return {
    render(width: number): string[] {
      const out: string[] = []
      const bodyRows = Math.max(0, FRAME_ROWS - 8)
      const rows = slot.content.slice(0, bodyRows)
      out.push(
        sep(width, theme),
        blank(width),
        cut(theme.fg('accent', slot.title), width),
        blank(width),
      )
      for (let i = 0; i < rows.length; i++) {
        const value = coloredLine(rows[i], theme)
        out.push(cut(slot.active.includes(i) ? theme.fg('accent', value) : value, width))
      }
      for (let i = 0; i < Math.max(0, FRAME_ROWS - (8 + rows.length)); i++) out.push(blank(width))
      out.push(
        blank(width),
        cut(` ${theme.fg('dim', foot(slot))}`, width),
        blank(width),
        sep(width, theme),
      )
      return out.slice(0, FRAME_ROWS)
    },
    invalidate() {},
  }
}

function pad(value: string, width: number): string {
  const cropped = truncateToWidth(value, width)
  return cropped + ' '.repeat(Math.max(0, width - visibleWidth(cropped)))
}
function detailTitlebar(title: string, inner: number, theme: Theme): string {
  const plain = ` ${title} `
  const size = Math.max(0, inner - plain.length)
  const left = Math.floor(size / 2)
  const right = Math.max(0, size - left)
  return pad(
    theme.fg('borderMuted', '─'.repeat(left)) +
      theme.fg('accent', plain) +
      theme.fg('borderMuted', '─'.repeat(right)),
    inner,
  )
}
function frame(lines: string[], width: number, title: string, theme: Theme): string[] {
  const inner = Math.max(4, width - 4)
  const border = (v: string) => theme.fg('borderMuted', v)
  const out = [
    border(`┌${'─'.repeat(inner)}┐`),
    border('│') + detailTitlebar(title, inner, theme) + border('│'),
    border('│') + ' '.repeat(inner) + border('│'),
  ]
  for (const line of lines) out.push(border('│') + pad(line, inner) + border('│'))
  out.push(border(`└${'─'.repeat(inner)}┘`))
  return out
}
export function renderDetail(slot: Slot, width: number, bottom: number, theme: Theme): string[] {
  const body = slot.content.map((line) => coloredLine(line, theme))
  const take = Math.max(1, bottom * 2 - 4)
  return frame(body.slice(0, take), width, slot.title, theme)
}

export function staticPrimitive(slot: () => Slot): Primitive {
  return {
    slot,
    up: () => {},
    down: () => {},
    search: () => false,
    set: (_query: string) => {},
    enter: () => undefined,
    hasView: () => false,
    view: () => undefined,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
function padCell(value: string, width: number, align: Align): string {
  const valueText = value.length > width ? value.slice(0, Math.max(0, width)) : value
  const size = Math.max(0, width - valueText.length)
  return align === 'right' ? ' '.repeat(size) + valueText : valueText + ' '.repeat(size)
}
function listView<T>(opts: ListOptions<T>, query: string): T[] {
  if (!query) return opts.items
  const low = query.toLowerCase()
  return opts.items.filter((item) => opts.find(item, low))
}
function listLine<T>(item: T, mark: string, cols: Col<T>[]): Line {
  const visible = cols.filter((col) => col.show)
  const cells: Cell[] = [{ text: mark, tone: 'normal' }]
  for (let i = 0; i < visible.length; i++) {
    const col = visible[i]
    cells.push({ text: padCell(col.pick(item), col.width, col.align), tone: col.tone })
    if (i < visible.length - 1) cells.push({ text: '  ', tone: 'normal' })
  }
  return { cells }
}
function flowline<T>(
  list: T[],
  state: { sel: number },
  top: number,
  rowi: number,
  rows: number,
  cols: number,
  col: Col<T>,
): Line {
  const cells: Cell[] = []
  const gap = '    '
  for (let c = 0; c < cols; c++) {
    const idx = top + c * rows + rowi
    if (idx >= list.length) {
      cells.push({ text: padCell('', col.width + 2, 'left'), tone: 'normal' })
      if (c < cols - 1) cells.push({ text: gap, tone: 'normal' })
      continue
    }
    const mark = idx === state.sel ? '› ' : '  '
    cells.push({
      text: mark + padCell(col.pick(list[idx]), col.width, 'left'),
      tone: idx === state.sel ? 'accent' : col.tone,
    })
    if (c < cols - 1) cells.push({ text: gap, tone: 'normal' })
  }
  return { cells }
}
function createList<T>(opts: ListOptions<T>): Primitive & { query: () => string } {
  const state = { sel: 0, top: 0, query: '' }
  const pagesize = () => (opts.flow ? opts.page * opts.flow.columns : opts.page)
  const reset = () => {
    const rows = listView(opts, state.query)
    const max = Math.max(0, rows.length - 1)
    state.sel = clamp(state.sel, 0, max)
    if (!opts.flow) {
      state.top = clamp(state.top, 0, Math.max(0, max - opts.page + 1))
      return
    }
    const size = pagesize()
    state.top = size <= 0 ? 0 : Math.floor(state.sel / size) * size
  }
  const move = (step: number) => {
    const rows = listView(opts, state.query)
    const max = Math.max(0, rows.length - 1)
    if (rows.length === 0) return
    const next = state.sel + step < 0 ? max : state.sel + step > max ? 0 : state.sel + step
    if (next === state.sel) return
    state.sel = next
    if (!opts.flow) {
      if (state.sel < state.top) state.top = state.sel
      else if (state.sel >= state.top + opts.page) state.top = state.sel - opts.page + 1
      return
    }
    const size = pagesize()
    if (size <= 0) state.top = 0
    else if (state.sel < state.top || state.sel >= state.top + size)
      state.top = Math.floor(state.sel / size) * size
  }
  return {
    up: () => move(-1),
    down: () => move(1),
    set: (query: string) => {
      state.query = query
      state.sel = 0
      state.top = 0
      reset()
    },
    query: () => state.query,
    search: () => opts.search,
    enter: () => {
      const rows = listView(opts, state.query)
      return rows.length === 0 ? undefined : opts.intent(rows[state.sel])
    },
    hasView: () => opts.view !== undefined,
    view: () => {
      if (!opts.view) return undefined
      const rows = listView(opts, state.query)
      return rows.length === 0 ? undefined : opts.view(rows[state.sel])
    },
    slot: () => {
      const rows = opts.prompt ? [row('> '), row('')] : []
      const list = listView(opts, state.query)
      if (!opts.flow) {
        for (let i = 0; i < opts.page; i++) {
          const idx = state.top + i
          rows.push(
            idx >= list.length
              ? row('')
              : listLine(list[idx], idx === state.sel ? '› ' : '  ', opts.cols),
          )
        }
        const base = opts.prompt ? 2 : 0
        return {
          title: state.query ? `${opts.title} (search: ${state.query})` : opts.title,
          content: rows,
          shortcuts: opts.shortcuts,
          active: list.length === 0 ? [] : [base + (state.sel - state.top)],
          tier: opts.tier,
          tab: opts.tab,
        }
      }
      const col = opts.cols.find((item) => item.show)
      if (!col) throw new Error('Flow layout requires at least one visible column.')
      for (let i = 0; i < opts.page; i++)
        rows.push(flowline(list, state, state.top, i, opts.page, opts.flow.columns, col))
      return {
        title: state.query ? `${opts.title} (search: ${state.query})` : opts.title,
        content: rows,
        shortcuts: opts.shortcuts,
        active: [],
        tier: opts.tier,
        tab: opts.tab,
      }
    },
  }
}

export function createAction<T>(
  opts: ActionOptions<T>,
  tier: 'top' | 'nested',
): Primitive & { query: () => string } {
  return createList({ ...opts, tier, tab: tier === 'top', search: false, prompt: false })
}

export function createDetail(opts: {
  title: string
  meta: string[]
  body: string[]
  block?: string[]
}): Primitive {
  const head = opts.meta.map((item) => row(item, 'dim'))
  const block =
    opts.block && opts.block.length > 0 ? opts.block.map((item) => row(item, 'dim')) : []
  const rows = [
    ...head,
    row(''),
    ...block,
    ...(block.length > 0 ? [row('')] : []),
    ...opts.body.map((item) => row(item)),
  ]
  const state = { top: 0 }
  const max = Math.max(0, rows.length - DETAIL_PAGE)
  const move = (step: number) => {
    if (max === 0) {
      state.top = 0
      return
    }
    const next = state.top + step
    if (next < 0) state.top = max
    else if (next > max) state.top = 0
    else state.top = clamp(next, 0, max)
  }
  return {
    slot: () => {
      const start = rows.length === 0 ? 0 : state.top + 1
      const end = rows.length === 0 ? 0 : Math.min(rows.length, state.top + DETAIL_PAGE)
      return {
        title: opts.title,
        content: [
          row(`scroll ${start}-${end}/${rows.length}`, 'dim'),
          ...rows.slice(state.top, state.top + DETAIL_PAGE - 1),
        ],
        shortcuts: '',
        active: [],
        tier: 'nested',
        tab: false,
      }
    },
    up: () => move(-1),
    down: () => move(1),
    search: () => false,
    set: (_query: string) => {},
    enter: () => undefined,
    hasView: () => false,
    view: () => undefined,
  }
}

function pickerWidth<T>(items: PickerItem<T>[]): number {
  const max = items.reduce((now, item) => Math.max(now, item.label.length), 0)
  return Math.max(24, Math.min(72, max + 2))
}
function defaultPickerShortcuts(search: boolean): string {
  return search ? 'enter select • / search • esc cancel' : 'enter select • esc cancel'
}
function defaultPickerMatch<T>(item: PickerItem<T>, query: string): boolean {
  return `${item.label} ${item.searchableText ?? ''}`.toLowerCase().includes(query.toLowerCase())
}
function pickerSlot(base: Slot, shortcuts: string, search: boolean): Slot {
  return search ? { ...base, shortcuts: `${shortcuts} • typing` } : { ...base, shortcuts }
}
function pick<T>(
  intent: Intent | undefined,
  values: Map<string, T>,
): { ok: boolean; value: T | undefined } {
  if (intent?.type !== 'action' || !values.has(intent.name)) return { ok: false, value: undefined }
  return { ok: true, value: values.get(intent.name) }
}
export async function runPicker<T>(ctx: Ctx, options: PickerOptions<T>): Promise<T | undefined> {
  if (!ctx.hasUI) throw new Error('Picker requires interactive mode.')
  const enabled = options.search !== false
  const rows = options.items.map((item, i) => ({ id: `pick:${i}`, label: item.label, item }))
  const values = new Map(rows.map((item) => [item.id, item.item.value]))
  const finder = options.match ?? defaultPickerMatch
  const shortcuts = options.shortcuts ?? defaultPickerShortcuts(enabled)
  const list = createList({
    title: options.title,
    items: rows,
    shortcuts,
    tier: 'nested',
    tab: false,
    search: enabled,
    prompt: false,
    page: Math.min(PICKER_PAGE, Math.max(1, options.page ?? PICKER_PAGE)),
    find: (item, query) => finder(item.item, query),
    intent: (item) => ({ type: 'action', name: item.id }),
    cols: [
      {
        show: true,
        width: pickerWidth(options.items),
        tone: 'normal',
        align: 'left',
        pick: (item) => item.label,
      },
    ],
  })
  const state = { search: false, query: '' }
  const apply = () => list.set(state.query)
  return ctx.ui.custom<T | undefined>((tui, theme, _keys, done) => ({
    render: (w) => create(pickerSlot(list.slot(), shortcuts, state.search), theme).render(w),
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
        if (enabled && slash(data)) {
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
          return
        }
        if (enter(data)) {
          const hit = pick(list.enter(), values)
          if (hit.ok) done(hit.value)
        }
        return
      }
      if (esc(data)) return done(undefined)
      if (enabled && slash(data)) {
        state.search = true
        tui.requestRender()
        return
      }
      if (down(data)) {
        list.down()
        tui.requestRender()
        return
      }
      if (up(data)) {
        list.up()
        tui.requestRender()
        return
      }
      if (enter(data)) {
        const hit = pick(list.enter(), values)
        if (hit.ok) done(hit.value)
      }
    },
  }))
}

function splitLines(initial: string | undefined): string[] {
  const out = initial?.split('\n') ?? ['']
  return out.length === 0 ? [''] : out
}
function wrap(line: string, width: number): string[] {
  if (line.length === 0) return ['']
  const out: string[] = []
  for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width))
  return out.length === 0 ? [''] : out
}
function wrappedRows(lines: string[], width: number): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = []
  for (let i = 0; i < lines.length; i++)
    for (const part of wrap(lines[i], width)) out.push({ line: i, text: part })
  return out.length === 0 ? [{ line: 0, text: '' }] : out
}
function rowCount(line: string, width: number): number {
  return line.length === 0 ? 1 : Math.ceil(line.length / width)
}
function cursorRow(lines: string[], line: number, col: number, width: number): number {
  let idx = 0
  for (let i = 0; i < line; i++) idx += rowCount(lines[i], width)
  const current = lines[line] ?? ''
  if (current.length === 0) return idx
  const at = Math.min(col, current.length)
  const pos = at === current.length ? Math.max(0, at - 1) : at
  return idx + Math.floor(pos / width)
}
function clampComposer(state: { lines: string[]; line: number; col: number }) {
  state.line = Math.max(0, Math.min(state.line, state.lines.length - 1))
  state.col = Math.max(0, Math.min(state.col, (state.lines[state.line] ?? '').length))
}
function keepCursor(
  state: { lines: string[]; line: number; col: number; width: number; top: number },
  total: number,
) {
  const cur = cursorRow(state.lines, state.line, state.col, state.width)
  if (cur < state.top) state.top = cur
  if (cur >= state.top + COMPOSER_VISIBLE_ROWS) state.top = cur - COMPOSER_VISIBLE_ROWS + 1
  state.top = Math.max(0, Math.min(state.top, Math.max(0, total - COMPOSER_VISIBLE_ROWS)))
}
function withCursor(line: string, col: number): Line {
  return {
    cells: [
      { text: line.slice(0, col), tone: 'normal' },
      { text: '▏', tone: 'accent' },
      { text: line.slice(col), tone: 'normal' },
    ],
  }
}
function composerOut(state: { lines: string[] }): string {
  return state.lines.join('\n')
}
function isNewline(data: string): boolean {
  return (
    matchesKey(data, 'shift+enter') ||
    matchesKey(data, 'shift+return') ||
    matchesKey(data, 'alt+enter') ||
    matchesKey(data, 'alt+return')
  )
}
function composerSlot(
  state: { lines: string[]; line: number; col: number; width: number; top: number; dirty: boolean },
  options: ComposerOptions,
): Slot {
  const parts = wrappedRows(state.lines, state.width)
  keepCursor(state, parts.length)
  const cur = cursorRow(state.lines, state.line, state.col, state.width)
  const body = parts.slice(state.top, state.top + COMPOSER_VISIBLE_ROWS)
  const start = parts.length === 0 ? 0 : state.top + 1
  const finish = parts.length === 0 ? 0 : Math.min(parts.length, state.top + COMPOSER_VISIBLE_ROWS)
  const focus = cur - state.top
  const title = `${options.title} · Ln ${state.line + 1}, Col ${state.col + 1}${state.dirty ? ' *' : ''}`
  const lines = [row(`scroll ${start}-${finish}/${parts.length}`, 'dim')]
  for (let i = 0; i < body.length; i++) {
    const item = body[i]
    const mark = item.line === state.line ? '›' : ' '
    const prefix = `${mark} ${String(item.line + 1).padStart(3, ' ')} `
    if (i === focus) {
      if (
        item.text.length === 0 &&
        state.lines.length === 1 &&
        state.lines[0] === '' &&
        options.placeholder
      ) {
        lines.push({
          cells: [
            { text: prefix, tone: 'dim' },
            { text: '▏', tone: 'accent' },
            { text: options.placeholder, tone: 'dim' },
          ],
        })
        continue
      }
      const anchor =
        state.width * Math.floor(Math.max(0, state.col - (state.col > 0 ? 1 : 0)) / state.width)
      const local = Math.max(0, Math.min(state.col - anchor, item.text.length))
      lines.push({ cells: [{ text: prefix, tone: 'dim' }, ...withCursor(item.text, local).cells] })
      continue
    }
    if (
      item.text.length === 0 &&
      state.lines.length === 1 &&
      state.lines[0] === '' &&
      options.placeholder
    )
      lines.push({
        cells: [
          { text: prefix, tone: 'dim' },
          { text: options.placeholder, tone: 'dim' },
        ],
      })
    else
      lines.push({
        cells: [
          { text: prefix, tone: 'dim' },
          { text: item.text, tone: 'normal' },
        ],
      })
  }
  return {
    title,
    content: lines,
    shortcuts: options.shortcuts ?? 'enter send • shift+enter/alt+enter newline • esc back',
    active: [],
    tier: 'nested',
    tab: false,
  }
}
export async function runComposer(ctx: Ctx, options: ComposerOptions): Promise<string | undefined> {
  if (!ctx.hasUI) throw new Error('Composer requires interactive mode.')
  const initial = options.initial ?? ''
  const state = {
    lines: splitLines(options.initial),
    line: 0,
    col: 0,
    top: 0,
    width: 80,
    length: initial.length,
    dirty: false,
  }
  const can = (extra: number) =>
    options.maxLength === undefined || state.length + extra <= options.maxLength
  const setDirty = () => {
    state.dirty = composerOut(state) !== initial
  }
  const write = (value: string) => {
    if (!can(value.length)) return
    const current = state.lines[state.line] ?? ''
    state.lines[state.line] = current.slice(0, state.col) + value + current.slice(state.col)
    state.col += value.length
    state.length += value.length
    setDirty()
  }
  const br = () => {
    if ((options.maxLines !== undefined && state.lines.length >= options.maxLines) || !can(1))
      return
    const current = state.lines[state.line] ?? ''
    state.lines[state.line] = current.slice(0, state.col)
    state.lines.splice(state.line + 1, 0, current.slice(state.col))
    state.line += 1
    state.col = 0
    state.length += 1
    setDirty()
  }
  const bs = () => {
    if (state.col > 0) {
      const current = state.lines[state.line] ?? ''
      state.lines[state.line] = current.slice(0, state.col - 1) + current.slice(state.col)
      state.col -= 1
      state.length -= 1
      setDirty()
      return
    }
    if (state.line === 0) return
    const prev = state.lines[state.line - 1] ?? ''
    const current = state.lines[state.line] ?? ''
    state.col = prev.length
    state.lines[state.line - 1] = prev + current
    state.lines.splice(state.line, 1)
    state.line -= 1
    state.length -= 1
    setDirty()
  }
  const del = () => {
    const current = state.lines[state.line] ?? ''
    if (state.col < current.length) {
      state.lines[state.line] = current.slice(0, state.col) + current.slice(state.col + 1)
      state.length -= 1
      setDirty()
      return
    }
    if (state.line >= state.lines.length - 1) return
    state.lines[state.line] = current + (state.lines[state.line + 1] ?? '')
    state.lines.splice(state.line + 1, 1)
    state.length -= 1
    setDirty()
  }
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => ({
    render: (width) => {
      state.width = Math.max(8, width - 6)
      return create(composerSlot(state, options), theme).render(width)
    },
    invalidate: () => {},
    handleInput: (data) => {
      if (esc(data)) return done(undefined)
      if (isNewline(data)) {
        br()
        tui.requestRender()
        return
      }
      if (enter(data)) return done(composerOut(state))
      if (matchesKey(data, 'left')) {
        if (state.col > 0) state.col -= 1
        else if (state.line > 0) {
          state.line -= 1
          state.col = (state.lines[state.line] ?? '').length
        }
      } else if (matchesKey(data, 'right')) {
        const current = state.lines[state.line] ?? ''
        if (state.col < current.length) state.col += 1
        else if (state.line < state.lines.length - 1) {
          state.line += 1
          state.col = 0
        }
      } else if (matchesKey(data, 'up')) {
        if (state.line > 0) {
          state.line -= 1
          state.col = Math.min(state.col, (state.lines[state.line] ?? '').length)
        }
      } else if (matchesKey(data, 'down')) {
        if (state.line < state.lines.length - 1) {
          state.line += 1
          state.col = Math.min(state.col, (state.lines[state.line] ?? '').length)
        }
      } else if (matchesKey(data, 'home')) state.col = 0
      else if (matchesKey(data, 'end')) state.col = (state.lines[state.line] ?? '').length
      else if (back(data)) bs()
      else if (matchesKey(data, 'delete')) del()
      else if (text(data)) write(data)
      else return
      clampComposer(state)
      tui.requestRender()
    },
  }))
}
