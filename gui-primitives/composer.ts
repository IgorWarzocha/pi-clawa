import { matchesKey } from '@earendil-works/pi-tui'
import { create, row } from './frame.js'
import { back, enter, esc, text } from './keys.js'
import type { ComposerOptions, Ctx, Line, Slot } from './types.js'
import { COMPOSER_VISIBLE_ROWS } from './types.js'

type ComposerState = {
  lines: string[]
  line: number
  col: number
  top: number
  width: number
  length: number
  dirty: boolean
}

type ComposerOps = {
  br: () => void
  bs: () => void
  del: () => void
  write: (value: string) => void
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
function clampComposer(state: Pick<ComposerState, 'lines' | 'line' | 'col'>) {
  state.line = Math.max(0, Math.min(state.line, state.lines.length - 1))
  state.col = Math.max(0, Math.min(state.col, (state.lines[state.line] ?? '').length))
}
function keepCursor(state: ComposerState, total: number) {
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

function isBlankInitial(state: ComposerState): boolean {
  return state.lines.length === 1 && state.lines[0] === ''
}

function composerPrefix(state: ComposerState, line: number): string {
  const mark = line === state.line ? '›' : ' '
  return `${mark} ${String(line + 1).padStart(3, ' ')} `
}

function placeholderLine(prefix: string, focused: boolean, placeholder: string): Line {
  const cells: Line['cells'] = [{ text: prefix, tone: 'dim' }]
  if (focused) cells.push({ text: '▏', tone: 'accent' })
  cells.push({ text: placeholder, tone: 'dim' })
  return { cells }
}

function cursorColumn(state: ComposerState, textLength: number): number {
  const beforeCursor = Math.max(0, state.col - (state.col > 0 ? 1 : 0))
  const anchor = state.width * Math.floor(beforeCursor / state.width)
  return Math.max(0, Math.min(state.col - anchor, textLength))
}

function composerBodyLine(options: {
  state: ComposerState
  item: { line: number; text: string }
  focused: boolean
  placeholder?: string
}): Line {
  const { state, item, focused, placeholder } = options
  const prefix = composerPrefix(state, item.line)
  if (item.text.length === 0 && isBlankInitial(state) && placeholder) {
    return placeholderLine(prefix, focused, placeholder)
  }
  if (focused) {
    return {
      cells: [
        { text: prefix, tone: 'dim' },
        ...withCursor(item.text, cursorColumn(state, item.text.length)).cells,
      ],
    }
  }
  return {
    cells: [
      { text: prefix, tone: 'dim' },
      { text: item.text, tone: 'normal' },
    ],
  }
}

function scrollLabel(top: number, total: number): string {
  const start = total === 0 ? 0 : top + 1
  const finish = total === 0 ? 0 : Math.min(total, top + COMPOSER_VISIBLE_ROWS)
  return `scroll ${start}-${finish}/${total}`
}

function composerSlot(state: ComposerState, options: ComposerOptions): Slot {
  const parts = wrappedRows(state.lines, state.width)
  keepCursor(state, parts.length)
  const cur = cursorRow(state.lines, state.line, state.col, state.width)
  const body = parts.slice(state.top, state.top + COMPOSER_VISIBLE_ROWS)
  const focus = cur - state.top
  const title = `${options.title} · Ln ${state.line + 1}, Col ${state.col + 1}${state.dirty ? ' *' : ''}`
  const lines = [row(scrollLabel(state.top, parts.length), 'dim')]
  for (let i = 0; i < body.length; i++) {
    const item = body[i]
    lines.push(
      composerBodyLine({ state, item, focused: i === focus, placeholder: options.placeholder }),
    )
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

function moveLeft(state: ComposerState): void {
  if (state.col > 0) state.col -= 1
  else if (state.line > 0) {
    state.line -= 1
    state.col = (state.lines[state.line] ?? '').length
  }
}

function moveRight(state: ComposerState): void {
  const current = state.lines[state.line] ?? ''
  if (state.col < current.length) state.col += 1
  else if (state.line < state.lines.length - 1) {
    state.line += 1
    state.col = 0
  }
}

function moveVertical(state: ComposerState, step: -1 | 1): void {
  const next = state.line + step
  if (next < 0 || next >= state.lines.length) return
  state.line = next
  state.col = Math.min(state.col, (state.lines[state.line] ?? '').length)
}

function handleCursorKey(data: string, state: ComposerState): boolean {
  if (matchesKey(data, 'left')) moveLeft(state)
  else if (matchesKey(data, 'right')) moveRight(state)
  else if (matchesKey(data, 'up')) moveVertical(state, -1)
  else if (matchesKey(data, 'down')) moveVertical(state, 1)
  else if (matchesKey(data, 'home')) state.col = 0
  else if (matchesKey(data, 'end')) state.col = (state.lines[state.line] ?? '').length
  else return false
  return true
}

function handleEditKey(data: string, ops: ComposerOps): boolean {
  if (back(data)) ops.bs()
  else if (matchesKey(data, 'delete')) ops.del()
  else if (text(data)) ops.write(data)
  else return false
  return true
}

function handleComposerInput(options: {
  data: string
  state: ComposerState
  ops: ComposerOps
  done: (result: string | undefined) => void
  render: () => void
}): void {
  const { data, state, ops, done, render } = options
  if (esc(data)) {
    done(undefined)
    return
  }
  if (isNewline(data)) {
    ops.br()
    render()
    return
  }
  if (enter(data)) {
    done(composerOut(state))
    return
  }
  if (!(handleCursorKey(data, state) || handleEditKey(data, ops))) return
  clampComposer(state)
  render()
}

export async function runComposer(ctx: Ctx, options: ComposerOptions): Promise<string | undefined> {
  if (!ctx.hasUI) throw new Error('Composer requires interactive mode.')
  const initial = options.initial ?? ''
  const state: ComposerState = {
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
  const ops = { br, bs, del, write }
  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => ({
    render: (width) => {
      state.width = Math.max(8, width - 6)
      return create(composerSlot(state, options), theme).render(width)
    },
    invalidate: () => {},
    handleInput: (data) =>
      handleComposerInput({ data, state, ops, done, render: () => tui.requestRender() }),
  }))
}
