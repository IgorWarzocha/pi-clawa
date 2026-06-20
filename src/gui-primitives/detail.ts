import { clamp, row } from './frame.js'
import type { Primitive } from './types.js'
import { DETAIL_PAGE } from './types.js'

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
