import { create } from './frame.js'
import { back, down, enter, esc, slash, text, up } from './keys.js'
import { createList } from './list.js'
import type { Ctx, Intent, PickerItem, PickerOptions, Slot } from './types.js'
import { PICKER_PAGE } from './types.js'

type PickerState = { search: boolean; query: string }

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
  const name = intent?.type === 'action' ? intent.name : undefined
  if (!(name && values.has(name))) return { ok: false, value: undefined }
  return { ok: true, value: values.get(name) }
}

function choose<T>(
  list: { enter: () => Intent | undefined },
  values: Map<string, T>,
): T | undefined {
  const hit = pick(list.enter(), values)
  return hit.ok ? hit.value : undefined
}

function handleSearchInput<T>(options: {
  data: string
  enabled: boolean
  state: PickerState
  apply: () => void
  render: () => void
  choose: () => T | undefined
  done: (value: T | undefined) => void
}): void {
  const { data, enabled, state, apply, render, done } = options
  if (esc(data)) {
    state.search = false
    state.query = ''
    apply()
    render()
    return
  }
  if (enabled && slash(data)) {
    state.search = false
    render()
    return
  }
  if (back(data)) {
    state.query = state.query.slice(0, -1)
    apply()
    render()
    return
  }
  if (text(data)) {
    state.query += data
    apply()
    render()
    return
  }
  if (enter(data)) done(options.choose())
}

function handlePickInput<T>(options: {
  data: string
  enabled: boolean
  state: PickerState
  list: { up: () => void; down: () => void }
  render: () => void
  choose: () => T | undefined
  done: (value: T | undefined) => void
}): void {
  const { data, enabled, state, list, render, done } = options
  if (esc(data)) {
    done(undefined)
    return
  }
  if (enabled && slash(data)) {
    state.search = true
    render()
    return
  }
  if (down(data)) {
    list.down()
    render()
    return
  }
  if (up(data)) {
    list.up()
    render()
    return
  }
  if (enter(data)) done(options.choose())
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
      const pickCurrent = () => choose(list, values)
      const render = () => tui.requestRender()
      if (state.search) {
        handleSearchInput({ data, enabled, state, apply, render, choose: pickCurrent, done })
        return
      }
      handlePickInput({ data, enabled, state, list, render, choose: pickCurrent, done })
    },
  }))
}
