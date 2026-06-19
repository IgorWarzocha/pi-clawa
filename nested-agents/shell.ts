import { existsSync } from 'node:fs'
import { resolvePath } from './paths.js'
import {
  GREP_OUTPUT_PATH_REGEX,
  LINE_SPLIT_REGEX,
  MAX_OUTPUT_LINES,
  type ToolContent,
  WHITESPACE_REGEX,
} from './types.js'

type GitCommandInfo = {
  subcommand: string
  directory: string | undefined
  subcommandIndex: number
}

type ShellTokenizer = {
  parts: string[]
  current: string
  quote: "'" | '"' | ''
  escaped: boolean
}

function shellCommandParts(value: string): string[] {
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

function gitCommandInfo(parts: string[], index: number): GitCommandInfo {
  let cursor = index + 1
  let directory: string | undefined
  while (cursor < parts.length) {
    const part = parts[cursor]
    if (part === '-C') {
      directory = parts[cursor + 1]
      cursor += 2
      continue
    }
    if (part?.startsWith('--git-dir=') || part?.startsWith('--work-tree=')) {
      cursor += 1
      continue
    }
    break
  }
  const subcommand = parts[cursor]?.toLowerCase() ?? ''
  return { subcommand, directory, subcommandIndex: cursor }
}

function isDiscoveryCommandAt(parts: string[], index: number): boolean {
  const command = parts[index]?.toLowerCase() ?? ''
  if (command === 'git') {
    const { subcommand } = gitCommandInfo(parts, index)
    return subcommand === 'ls-files' || subcommand === 'grep'
  }
  return DISCOVERY_COMMANDS.has(command)
}

function isPathOutputCommandAt(parts: string[], index: number): boolean {
  const command = parts[index]?.toLowerCase() ?? ''
  if (PATH_OUTPUT_COMMANDS.has(command)) return true
  if (command !== 'git') return false
  const { subcommand } = gitCommandInfo(parts, index)
  return subcommand === 'ls-files' || subcommand === 'grep'
}

const DISCOVERY_COMMANDS = new Set([
  'ls',
  'find',
  'rg',
  'grep',
  'fd',
  'tree',
  'cat',
  'sed',
  'head',
  'tail',
  'nl',
  'wc',
  'stat',
  'file',
  'du',
])
const PATH_OUTPUT_COMMANDS = new Set(['ls', 'find', 'rg', 'grep', 'fd', 'tree'])

export function isPathOutputShellCommand(value: string): boolean {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    if (isPathOutputCommandAt(parts, index)) return true
  }
  return false
}

export function shellOutputToolName(value: string): 'grep' | 'shell' {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    const command = parts[index]?.toLowerCase() ?? ''
    if (command === 'rg' || command === 'grep') return 'grep'
    if (command === 'git' && gitCommandInfo(parts, index).subcommand === 'grep') return 'grep'
  }
  return 'shell'
}

function maybePushPath(paths: string[], item: string, base: string): void {
  if (item === '.') {
    paths.push(base)
    return
  }
  if (item.startsWith('/')) {
    if (existsSync(item)) paths.push(resolvePath(item, base))
    return
  }
  if (item.startsWith('./') || item.startsWith('../') || item.includes('/')) {
    const resolved = resolvePath(item, base)
    if (existsSync(resolved)) paths.push(resolved)
  }
}

export function isDiscoveryShellCommand(value: string): boolean {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    if (isDiscoveryCommandAt(parts, index)) return true
  }
  return false
}

export function shellTargets(value: string, base: string): string[] {
  const parts = shellCommandParts(value)
  if (parts.length === 0) return [base]
  const state = { cwd: base, scanning: false, discoveryBase: base, skipNextPathLikeToken: false }
  const paths: string[] = []
  for (let index = 0; index < parts.length; index += 1) {
    index = collectShellTargetAt(parts, index, state, paths)
  }
  return paths.length > 0 ? paths : [state.cwd]
}

function collectShellTargetAt(
  parts: string[],
  index: number,
  state: { cwd: string; scanning: boolean; discoveryBase: string; skipNextPathLikeToken: boolean },
  paths: string[],
): number {
  const item = parts[index]
  if (!item || resetDiscoveryAtSeparator(item, state)) return index
  if (handleCd(parts, index, state)) return index + 1
  if (handleDiscoveryCommand(parts, index, state, paths)) return gitAwareIndex(parts, index, item)
  if (!shouldTreatAsDiscoveryPath(item, state)) return index
  if (state.skipNextPathLikeToken) {
    state.skipNextPathLikeToken = false
    return index
  }
  maybePushPath(paths, item, state.discoveryBase)
  return index
}

function gitAwareIndex(parts: string[], index: number, item: string): number {
  return item.toLowerCase() === 'git' ? gitCommandInfo(parts, index).subcommandIndex : index
}

function shouldTreatAsDiscoveryPath(item: string, state: { scanning: boolean }): boolean {
  return state.scanning && !item.startsWith('-') && !item.includes('=')
}

function resetDiscoveryAtSeparator(
  item: string,
  state: { cwd: string; scanning: boolean; discoveryBase: string; skipNextPathLikeToken: boolean },
): boolean {
  if (item !== ';') return false
  state.scanning = false
  state.discoveryBase = state.cwd
  state.skipNextPathLikeToken = false
  return true
}

function handleCd(
  parts: string[],
  index: number,
  state: { cwd: string; scanning: boolean },
): boolean {
  if (parts[index] !== 'cd') return false
  const next = parts[index + 1]
  if (next) state.cwd = resolvePath(next, state.cwd)
  state.scanning = false
  return true
}

function handleDiscoveryCommand(
  parts: string[],
  index: number,
  state: { cwd: string; scanning: boolean; discoveryBase: string; skipNextPathLikeToken: boolean },
  paths: string[],
): boolean {
  const item = parts[index]
  if (!(item && isDiscoveryCommandAt(parts, index))) return false
  state.scanning = true
  state.discoveryBase = state.cwd
  state.skipNextPathLikeToken = item === 'rg' || item === 'grep'
  if (item.toLowerCase() === 'git') {
    const { directory, subcommand } = gitCommandInfo(parts, index)
    if (directory) {
      state.discoveryBase = resolvePath(directory, state.cwd)
      paths.push(state.discoveryBase)
    }
    state.skipNextPathLikeToken = subcommand === 'grep'
  }
  return true
}

export function shellOutputBase(value: string, base: string): string {
  const parts = shellCommandParts(value)
  let cwd = base
  for (let index = 0; index < parts.length; index += 1) {
    const result = shellOutputBaseAt(parts, index, cwd)
    if (result.done) return result.cwd
    cwd = result.cwd
    index = result.index
  }
  return cwd
}

function shellOutputBaseAt(
  parts: string[],
  index: number,
  cwd: string,
): { cwd: string; index: number; done: boolean } {
  const item = parts[index]
  if (!item || item === ';') return { cwd, index, done: false }
  if (item === 'cd') {
    const next = parts[index + 1]
    return { cwd: next ? resolvePath(next, cwd) : cwd, index: index + 1, done: false }
  }
  if (!isDiscoveryCommandAt(parts, index)) return { cwd, index, done: false }
  if (item.toLowerCase() !== 'git') return { cwd, index, done: true }
  const { directory } = gitCommandInfo(parts, index)
  return { cwd: directory ? resolvePath(directory, cwd) : cwd, index, done: true }
}

function outputPathCandidate(line: string, toolName: string): string {
  if (toolName !== 'grep') return line
  const match = line.match(GREP_OUTPUT_PATH_REGEX)
  return match?.[1] ?? line.split(':', 1)[0] ?? line
}

function looksPathLike(value: string): boolean {
  return Boolean(value) && !value.includes('\0') && !value.startsWith('<')
}

export function pathsFromToolText(
  content: ToolContent[],
  base: string,
  toolName: string,
): string[] {
  return content.flatMap((item) => {
    if (item.type !== 'text' || !item.text) return []
    return item.text
      .split(LINE_SPLIT_REGEX)
      .slice(0, MAX_OUTPUT_LINES)
      .map((line) => outputPathCandidate(line.trim(), toolName))
      .filter((line) => line && looksPathLike(line))
      .map((line) => resolvePath(line, base))
      .filter((candidate) => existsSync(candidate))
  })
}
