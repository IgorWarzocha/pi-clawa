import type { ComposerOps, ComposerState } from './composer-types.js'
import { composerOut } from './composer-wrap.js'
import type { ComposerOptions } from './types.js'

export function createComposerOps(
  state: ComposerState,
  initial: string,
  options: ComposerOptions,
): ComposerOps {
  const can = (extra: number) =>
    options.maxLength === undefined || state.length + extra <= options.maxLength
  const setDirty = () => {
    state.dirty = composerOut(state) !== initial
  }

  return {
    write(value: string): void {
      if (!can(value.length)) return
      const current = state.lines[state.line] ?? ''
      state.lines[state.line] = current.slice(0, state.col) + value + current.slice(state.col)
      state.col += value.length
      state.length += value.length
      setDirty()
    },
    br(): void {
      if ((options.maxLines !== undefined && state.lines.length >= options.maxLines) || !can(1))
        return
      const current = state.lines[state.line] ?? ''
      state.lines[state.line] = current.slice(0, state.col)
      state.lines.splice(state.line + 1, 0, current.slice(state.col))
      state.line += 1
      state.col = 0
      state.length += 1
      setDirty()
    },
    bs(): void {
      backspace(state, setDirty)
    },
    del(): void {
      deleteAtCursor(state, setDirty)
    },
  }
}

function backspace(state: ComposerState, setDirty: () => void): void {
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

function deleteAtCursor(state: ComposerState, setDirty: () => void): void {
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
