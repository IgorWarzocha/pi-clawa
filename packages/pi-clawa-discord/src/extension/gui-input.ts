import { INPUT_CLEAN_NEWLINES_REGEX, INPUT_NEWLINE_REGEX } from './constants.js'
import type { DiscordGuiMode } from './gui-types.js'

export function handleEscape(options: {
  data: string
  mode: DiscordGuiMode
  setMode: (mode: DiscordGuiMode) => void
  done: () => void
  render: () => void
}): boolean {
  const { data, mode, setMode, done, render } = options
  if (data !== '\u001b') return false
  if (mode === 'menu') done()
  else {
    setMode('menu')
    render()
  }
  return true
}

export function handleTextInput(options: { data: string; input: string; render: () => void }): {
  input: string
  save: boolean
} {
  const { data, input, render } = options
  const newlineIndex = data.search(INPUT_NEWLINE_REGEX)
  if (newlineIndex >= 0) {
    return { input: input + data.slice(0, newlineIndex), save: true }
  }
  if (data === '\r' || data === '\n') return { input, save: true }
  if (data === '\u007f' || data === '\b') return backspace(input, render)
  const next = input + data.replace(INPUT_CLEAN_NEWLINES_REGEX, '')
  render()
  return { input: next, save: false }
}

function backspace(input: string, render: () => void): { input: string; save: boolean } {
  const next = input.slice(0, -1)
  render()
  return { input: next, save: false }
}

export function handleMenuInput(options: {
  data: string
  selected: number
  max: number
  activate: () => void
}): number {
  const { data, selected, max, activate } = options
  if (data === '\r' || data === '\n') {
    activate()
    return selected
  }
  if (data === '\u001b[A' || data === 'k') return Math.max(0, selected - 1)
  if (data === '\u001b[B' || data === 'j') return Math.min(max, selected + 1)
  return selected
}
