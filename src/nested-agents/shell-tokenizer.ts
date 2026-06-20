import { WHITESPACE_REGEX } from './types.js'

type ShellTokenizer = {
  parts: string[]
  current: string
  quote: "'" | '"' | ''
  escaped: boolean
}

export function shellCommandParts(value: string): string[] {
  const state: ShellTokenizer = { parts: [], current: '', quote: '', escaped: false }
  for (let index = 0; index < value.length; index += 1) {
    index = consumeShellChar(value, index, state)
  }
  flushCurrent(state)
  return state.parts.filter(Boolean)
}

function consumeShellChar(value: string, index: number, state: ShellTokenizer): number {
  const char = value[index]
  if (!char) return index
  if (consumeEscaped(char, state)) return index
  if (startEscape(char, state)) return index
  if (consumeQuoted(char, state)) return index
  if (startQuote(char, state)) return index
  if (consumeWhitespace(char, state)) return index
  if (consumeSeparator(char, value[index + 1], state))
    return index + separatorExtraSkip(char, value[index + 1])
  state.current += char
  return index
}

function flushCurrent(state: ShellTokenizer): void {
  if (!state.current) return
  state.parts.push(state.current)
  state.current = ''
}

function consumeEscaped(char: string, state: ShellTokenizer): boolean {
  if (!state.escaped) return false
  state.current += char
  state.escaped = false
  return true
}

function startEscape(char: string, state: ShellTokenizer): boolean {
  if (!(char === '\\' && state.quote !== "'")) return false
  state.escaped = true
  return true
}

function consumeQuoted(char: string, state: ShellTokenizer): boolean {
  if (!state.quote) return false
  if (char === state.quote) state.quote = ''
  else state.current += char
  return true
}

function startQuote(char: string, state: ShellTokenizer): boolean {
  if (!(char === "'" || char === '"')) return false
  state.quote = char
  return true
}

function consumeWhitespace(char: string, state: ShellTokenizer): boolean {
  if (!WHITESPACE_REGEX.test(char)) return false
  flushCurrent(state)
  return true
}

function consumeSeparator(char: string, next: string | undefined, state: ShellTokenizer): boolean {
  if (!isShellSeparator(char, next)) return false
  flushCurrent(state)
  state.parts.push(';')
  return true
}

function separatorExtraSkip(char: string, next: string | undefined): number {
  return (char === '|' && next === '|') || (char === '&' && next === '&') ? 1 : 0
}

function isShellSeparator(char: string, next: string | undefined): boolean {
  return char === ';' || char === '|' || (char === '&' && next === '&')
}
