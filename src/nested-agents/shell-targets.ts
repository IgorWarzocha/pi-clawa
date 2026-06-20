import { existsSync } from 'node:fs'
import { resolvePath } from './paths.js'
import { gitCommandInfo, isDiscoveryCommandAt } from './shell-commands.js'
import { shellCommandParts } from './shell-tokenizer.js'

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
  if (item.toLowerCase() === 'git') handleGitDiscovery(parts, index, state, paths)
  return true
}

function handleGitDiscovery(
  parts: string[],
  index: number,
  state: { cwd: string; discoveryBase: string; skipNextPathLikeToken: boolean },
  paths: string[],
): void {
  const { directory, subcommand } = gitCommandInfo(parts, index)
  if (directory) {
    state.discoveryBase = resolvePath(directory, state.cwd)
    paths.push(state.discoveryBase)
  }
  state.skipNextPathLikeToken = subcommand === 'grep'
}

function gitAwareIndex(parts: string[], index: number, item: string): number {
  return item.toLowerCase() === 'git' ? gitCommandInfo(parts, index).subcommandIndex : index
}

function shouldTreatAsDiscoveryPath(item: string, state: { scanning: boolean }): boolean {
  return state.scanning && !item.startsWith('-') && !item.includes('=')
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
