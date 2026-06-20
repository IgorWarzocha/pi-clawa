import { createComposerOps } from './composer-edit.js'
import { handleComposerInput } from './composer-input.js'
import { composerSlot } from './composer-render.js'
import type { ComposerState } from './composer-types.js'
import { splitLines } from './composer-wrap.js'
import { create } from './frame.js'
import type { ComposerOptions, Ctx } from './types.js'

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
  const ops = createComposerOps(state, initial, options)
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
