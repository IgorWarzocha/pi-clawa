import type { ComposerState, WrappedRow } from './composer-types.js'
import { cursorRow, keepCursor, wrappedRows } from './composer-wrap.js'
import { row } from './frame.js'
import type { ComposerOptions, Line, Slot } from './types.js'
import { COMPOSER_VISIBLE_ROWS } from './types.js'

function withCursor(line: string, col: number): Line {
  return {
    cells: [
      { text: line.slice(0, col), tone: 'normal' },
      { text: '▏', tone: 'accent' },
      { text: line.slice(col), tone: 'normal' },
    ],
  }
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
  item: WrappedRow
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

export function composerSlot(state: ComposerState, options: ComposerOptions): Slot {
  const parts = wrappedRows(state.lines, state.width)
  keepCursor(state, parts.length)
  const cur = cursorRow(state.lines, state.line, state.col, state.width)
  const body = parts.slice(state.top, state.top + COMPOSER_VISIBLE_ROWS)
  const focus = cur - state.top
  const title = `${options.title} · Ln ${state.line + 1}, Col ${state.col + 1}${state.dirty ? ' *' : ''}`
  const lines = [row(scrollLabel(state.top, parts.length), 'dim')]
  for (let i = 0; i < body.length; i++) {
    const item = body[i]
    if (!item) continue
    lines.push(
      composerBodyLine(
        options.placeholder === undefined
          ? { state, item, focused: i === focus }
          : { state, item, focused: i === focus, placeholder: options.placeholder },
      ),
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
