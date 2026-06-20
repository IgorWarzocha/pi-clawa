import type { ComposerState, WrappedRow } from './composer-types.js'
import { COMPOSER_VISIBLE_ROWS } from './types.js'

export function splitLines(initial: string | undefined): string[] {
  const out = initial?.split('\n') ?? ['']
  return out.length === 0 ? [''] : out
}

function wrap(line: string, width: number): string[] {
  if (line.length === 0) return ['']
  const out: string[] = []
  for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width))
  return out.length === 0 ? [''] : out
}

export function wrappedRows(lines: string[], width: number): WrappedRow[] {
  const out: WrappedRow[] = []
  for (let i = 0; i < lines.length; i++) {
    for (const part of wrap(lines[i] ?? '', width)) out.push({ line: i, text: part })
  }
  return out.length === 0 ? [{ line: 0, text: '' }] : out
}

function rowCount(line: string, width: number): number {
  return line.length === 0 ? 1 : Math.ceil(line.length / width)
}

export function cursorRow(lines: string[], line: number, col: number, width: number): number {
  let idx = 0
  for (let i = 0; i < line; i++) idx += rowCount(lines[i] ?? '', width)
  const current = lines[line] ?? ''
  if (current.length === 0) return idx
  const at = Math.min(col, current.length)
  const pos = at === current.length ? Math.max(0, at - 1) : at
  return idx + Math.floor(pos / width)
}

export function clampComposer(state: Pick<ComposerState, 'lines' | 'line' | 'col'>): void {
  state.line = Math.max(0, Math.min(state.line, state.lines.length - 1))
  state.col = Math.max(0, Math.min(state.col, (state.lines[state.line] ?? '').length))
}

export function keepCursor(state: ComposerState, total: number): void {
  const cur = cursorRow(state.lines, state.line, state.col, state.width)
  if (cur < state.top) state.top = cur
  if (cur >= state.top + COMPOSER_VISIBLE_ROWS) state.top = cur - COMPOSER_VISIBLE_ROWS + 1
  state.top = Math.max(0, Math.min(state.top, Math.max(0, total - COMPOSER_VISIBLE_ROWS)))
}

export function composerOut(state: { lines: string[] }): string {
  return state.lines.join('\n')
}
