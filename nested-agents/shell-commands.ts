import { shellCommandParts } from './shell-tokenizer.js'

export type GitCommandInfo = {
  subcommand: string
  directory: string | undefined
  subcommandIndex: number
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

export function gitCommandInfo(parts: string[], index: number): GitCommandInfo {
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

export function isDiscoveryCommandAt(parts: string[], index: number): boolean {
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

export function isDiscoveryShellCommand(value: string): boolean {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    if (isDiscoveryCommandAt(parts, index)) return true
  }
  return false
}
