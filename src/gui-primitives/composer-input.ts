import { matchesKey } from '@earendil-works/pi-tui'
import type { ComposerOps, ComposerState } from './composer-types.js'
import { clampComposer, composerOut } from './composer-wrap.js'
import { back, enter, esc, text } from './keys.js'

function isNewline(data: string): boolean {
  return (
    matchesKey(data, 'shift+enter') ||
    matchesKey(data, 'shift+return') ||
    matchesKey(data, 'alt+enter') ||
    matchesKey(data, 'alt+return')
  )
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

export function handleComposerInput(options: {
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
