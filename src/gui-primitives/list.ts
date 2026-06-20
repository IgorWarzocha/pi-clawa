import { clamp, padCell, row } from './frame.js'
import type { ActionOptions, Cell, Col, Line, ListOptions, Primitive } from './types.js'

type ListState = { sel: number; top: number; query: string }

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
    if (!col) continue
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
    const item = list[idx]
    if (item === undefined) continue
    cells.push({
      text: mark + padCell(col.pick(item), col.width, 'left'),
      tone: idx === state.sel ? 'accent' : col.tone,
    })
    if (c < cols - 1) cells.push({ text: gap, tone: 'normal' })
  }
  return { cells }
}

function pageSize<T>(opts: ListOptions<T>): number {
  return opts.flow ? opts.page * opts.flow.columns : opts.page
}

function resetList<T>(opts: ListOptions<T>, state: ListState): void {
  const rows = listView(opts, state.query)
  const max = Math.max(0, rows.length - 1)
  state.sel = clamp(state.sel, 0, max)
  if (!opts.flow) {
    state.top = clamp(state.top, 0, Math.max(0, max - opts.page + 1))
    return
  }
  const size = pageSize(opts)
  state.top = size <= 0 ? 0 : Math.floor(state.sel / size) * size
}

function wrapSelection(current: number, step: number, max: number): number {
  const next = current + step
  if (next < 0) return max
  if (next > max) return 0
  return next
}

function keepFlatSelectionVisible<T>(opts: ListOptions<T>, state: ListState): void {
  if (state.sel < state.top) state.top = state.sel
  else if (state.sel >= state.top + opts.page) state.top = state.sel - opts.page + 1
}

function keepFlowSelectionVisible<T>(opts: ListOptions<T>, state: ListState): void {
  const size = pageSize(opts)
  if (size <= 0) state.top = 0
  else if (state.sel < state.top || state.sel >= state.top + size)
    state.top = Math.floor(state.sel / size) * size
}

function moveList<T>(opts: ListOptions<T>, state: ListState, step: number): void {
  const rows = listView(opts, state.query)
  if (rows.length === 0) return
  const next = wrapSelection(state.sel, step, rows.length - 1)
  if (next === state.sel) return
  state.sel = next
  if (opts.flow) keepFlowSelectionVisible(opts, state)
  else keepFlatSelectionVisible(opts, state)
}

function createFlatSlot<T>(
  opts: ListOptions<T>,
  state: ListState,
  rows: Line[],
  list: T[],
): ReturnType<Primitive['slot']> {
  for (let i = 0; i < opts.page; i++) {
    const idx = state.top + i
    const item = list[idx]
    rows.push(
      item === undefined ? row('') : listLine(item, idx === state.sel ? '› ' : '  ', opts.cols),
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

function createFlowSlot<T>(
  opts: ListOptions<T>,
  state: ListState,
  rows: Line[],
  list: T[],
): ReturnType<Primitive['slot']> {
  const col = opts.cols.find((item) => item.show)
  if (!col) throw new Error('Flow layout requires at least one visible column.')
  for (let i = 0; i < opts.page; i++)
    rows.push(flowline(list, state, state.top, i, opts.page, opts.flow?.columns ?? 1, col))
  return {
    title: state.query ? `${opts.title} (search: ${state.query})` : opts.title,
    content: rows,
    shortcuts: opts.shortcuts,
    active: [],
    tier: opts.tier,
    tab: opts.tab,
  }
}

function createListSlot<T>(opts: ListOptions<T>, state: ListState): ReturnType<Primitive['slot']> {
  const rows = opts.prompt ? [row('> '), row('')] : []
  const list = listView(opts, state.query)
  return opts.flow
    ? createFlowSlot(opts, state, rows, list)
    : createFlatSlot(opts, state, rows, list)
}

export function createList<T>(opts: ListOptions<T>): Primitive & { query: () => string } {
  const state = { sel: 0, top: 0, query: '' }
  return {
    up: () => moveList(opts, state, -1),
    down: () => moveList(opts, state, 1),
    set: (query: string) => {
      state.query = query
      state.sel = 0
      state.top = 0
      resetList(opts, state)
    },
    query: () => state.query,
    search: () => opts.search,
    enter: () => {
      const rows = listView(opts, state.query)
      const item = rows[state.sel]
      return item === undefined ? undefined : opts.intent(item)
    },
    hasView: () => opts.view !== undefined,
    view: () => {
      if (!opts.view) return undefined
      const rows = listView(opts, state.query)
      const item = rows[state.sel]
      return item === undefined ? undefined : opts.view(item)
    },
    slot: () => createListSlot(opts, state),
  }
}

export function createAction<T>(
  opts: ActionOptions<T>,
  tier: 'top' | 'nested',
): Primitive & { query: () => string } {
  return createList({ ...opts, tier, tab: tier === 'top', search: false, prompt: false })
}
