import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

const DETAILS_KEY = 'clawaNestedAgentsContext'
const LINE_SPLIT_REGEX = /\r?\n/
const GREP_OUTPUT_PATH_REGEX = /^(.+?):\d+(?::\d+)?:/
const WHITESPACE_REGEX = /\s/
const MAX_OUTPUT_LINES = 250
const REFRESH_EVERY = 10

type TextContent = { type: 'text'; text: string }
type ToolContent = { type: string; text?: string }
type PersistedAgentsFile = { path: string; content: string }
type PersistedAgentsDetails = { files: PersistedAgentsFile[] }

type ToolResultLike = {
  toolName: string
  input: Record<string, unknown>
  content: ToolContent[]
  isError: boolean
  details?: unknown
}

function normalizeAtPrefix(inputPath: string): string {
  return inputPath.startsWith('@') ? inputPath.slice(1) : inputPath
}

function resolvePath(targetPath: string, baseDir: string): string {
  const cleaned = normalizeAtPrefix(targetPath)
  const absolute = isAbsolute(cleaned) ? normalize(cleaned) : resolve(baseDir, cleaned)
  try {
    return realpathMaybe(absolute)
  } catch {
    return absolute
  }
}

function realpathMaybe(path: string): string {
  return existsSync(path) ? (realpathSync.native?.(path) ?? realpathSync(path)) : path
}

function isInsideRoot(rootDir: string, targetPath: string): boolean {
  if (!rootDir) return false
  const rel = relative(rootDir, targetPath)
  return rel === '' || !(rel.startsWith('..') || isAbsolute(rel))
}

function contentRootForTarget(targetPath: string): string {
  try {
    const startDir =
      existsSync(targetPath) && statSync(targetPath).isDirectory()
        ? targetPath
        : dirname(targetPath)
    let dir = startDir
    let best = ''
    while (true) {
      if (existsSync(join(dir, 'AGENTS.md'))) best = dir
      if (existsSync(join(dir, '.git'))) return dir
      const parent = dirname(dir)
      if (parent === dir) return best || startDir
      dir = parent
    }
  } catch {
    return ''
  }
}

function agentsFromCwdToRoot(cwd: string): Set<string> {
  const ignored = new Set<string>()
  const root = contentRootForTarget(cwd)
  if (!root) return ignored
  let dir = cwd
  while (isInsideRoot(root, dir)) {
    const candidate = join(dir, 'AGENTS.md')
    if (existsSync(candidate)) ignored.add(normalize(candidate))
    if (dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ignored
}

function findAgentsFiles(filePath: string, rootDir: string, ignoredAgents: Set<string>): string[] {
  if (!rootDir) return []
  const agentsFiles: string[] = []
  let dir = dirname(filePath)
  while (isInsideRoot(rootDir, dir)) {
    const candidate = normalize(join(dir, 'AGENTS.md'))
    if (!ignoredAgents.has(candidate) && existsSync(candidate)) agentsFiles.push(candidate)
    if (dir === rootDir) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return agentsFiles.reverse()
}

function shellCommandParts(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: "'" | '"' | '' = ''
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (!char) continue
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (WHITESPACE_REGEX.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }
    if (char === ';' || char === '|' || (char === '&' && value[index + 1] === '&')) {
      if (current) {
        parts.push(current)
        current = ''
      }
      parts.push(';')
      if (
        (char === '|' && value[index + 1] === '|') ||
        (char === '&' && value[index + 1] === '&')
      ) {
        index += 1
      }
      continue
    }
    current += char
  }
  if (current) parts.push(current)
  return parts.filter(Boolean)
}

function gitCommandInfo(parts: string[], index: number) {
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
  return [
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
  ].includes(command)
}

function isPathOutputCommandAt(parts: string[], index: number): boolean {
  const command = parts[index]?.toLowerCase() ?? ''
  if (['ls', 'find', 'rg', 'grep', 'fd', 'tree'].includes(command)) return true
  if (command !== 'git') return false
  const { subcommand } = gitCommandInfo(parts, index)
  return subcommand === 'ls-files' || subcommand === 'grep'
}

function isPathOutputShellCommand(value: string): boolean {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    if (isPathOutputCommandAt(parts, index)) return true
  }
  return false
}

function shellOutputToolName(value: string): 'grep' | 'shell' {
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

function isDiscoveryShellCommand(value: string): boolean {
  const parts = shellCommandParts(value)
  for (let index = 0; index < parts.length; index += 1) {
    if (isDiscoveryCommandAt(parts, index)) return true
  }
  return false
}

function shellTargets(value: string, base: string): string[] {
  const parts = shellCommandParts(value)
  if (parts.length === 0) return [base]
  const paths: string[] = []
  let cwd = base
  let scanningDiscoveryCommand = false
  let discoveryBase = cwd
  let skipNextPathLikeToken = false
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index]
    if (!item) continue
    if (item === ';') {
      scanningDiscoveryCommand = false
      discoveryBase = cwd
      skipNextPathLikeToken = false
      continue
    }
    if (item === 'cd') {
      const next = parts[index + 1]
      if (next) cwd = resolvePath(next, cwd)
      index += 1
      scanningDiscoveryCommand = false
      continue
    }
    if (isDiscoveryCommandAt(parts, index)) {
      scanningDiscoveryCommand = true
      discoveryBase = cwd
      skipNextPathLikeToken = item === 'rg' || item === 'grep'
      if (item.toLowerCase() === 'git') {
        const { directory, subcommand, subcommandIndex } = gitCommandInfo(parts, index)
        if (directory) {
          discoveryBase = resolvePath(directory, cwd)
          paths.push(discoveryBase)
        }
        skipNextPathLikeToken = subcommand === 'grep'
        index = subcommandIndex
      }
      continue
    }
    if (!scanningDiscoveryCommand) continue
    if (item.startsWith('-') || item.includes('=')) continue
    if (skipNextPathLikeToken) {
      skipNextPathLikeToken = false
      continue
    }
    maybePushPath(paths, item, discoveryBase)
  }
  return paths.length > 0 ? paths : [cwd]
}

function shellOutputBase(value: string, base: string): string {
  const parts = shellCommandParts(value)
  let cwd = base
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index]
    if (!item || item === ';') continue
    if (item === 'cd') {
      const next = parts[index + 1]
      if (next) cwd = resolvePath(next, cwd)
      index += 1
      continue
    }
    if (isDiscoveryCommandAt(parts, index)) {
      if (item.toLowerCase() !== 'git') return cwd
      const { directory } = gitCommandInfo(parts, index)
      return directory ? resolvePath(directory, cwd) : cwd
    }
  }
  return cwd
}

function outputPathCandidate(line: string, toolName: string): string {
  if (toolName !== 'grep') return line
  const match = line.match(GREP_OUTPUT_PATH_REGEX)
  return match?.[1] ?? line.split(':', 1)[0] ?? line
}

function looksPathLike(value: string): boolean {
  return Boolean(value) && !value.includes('\0') && !value.startsWith('<')
}

function pathsFromToolText(content: ToolContent[], base: string, toolName: string): string[] {
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

function parsePersistedContextDetails(details: unknown): PersistedAgentsDetails | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null
  const value = (details as Record<string, unknown>)[DETAILS_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const files = (value as Record<string, unknown>).files
  if (!Array.isArray(files)) return null
  const parsed = files.filter((item): item is PersistedAgentsFile => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const pathValue = (item as Record<string, unknown>).path
    const contentValue = (item as Record<string, unknown>).content
    return typeof pathValue === 'string' && typeof contentValue === 'string'
  })
  if (parsed.length === 0) return null
  return { files: parsed.map((item) => ({ path: item.path, content: item.content })) }
}

function mergePersistedContextDetails(
  baseDetails: unknown,
  injected: PersistedAgentsDetails,
): Record<string, unknown> {
  if (baseDetails && typeof baseDetails === 'object' && !Array.isArray(baseDetails)) {
    return { ...(baseDetails as Record<string, unknown>), [DETAILS_KEY]: injected }
  }
  return { [DETAILS_KEY]: injected }
}

function collectBranchContext(
  ctx: ExtensionContext,
  currentCwd: string,
  ignoredAgents: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>()
  const branchEntries = ctx.sessionManager.getBranch()
  for (const entry of branchEntries) {
    if (!entry || typeof entry !== 'object' || entry.type !== 'message') continue
    const message = (entry as { message?: unknown }).message
    if (!message || typeof message !== 'object' || Array.isArray(message)) continue
    const persisted = parsePersistedContextDetails((message as { details?: unknown }).details)
    if (!persisted) continue
    for (const file of persisted.files) {
      const absolute = normalize(resolvePath(file.path, currentCwd))
      if (basename(absolute) !== 'AGENTS.md' || ignoredAgents.has(absolute)) continue
      out.set(absolute, file.content)
    }
  }
  return out
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function appendAgentsContext<TContent extends { type: string }>(
  content: TContent[],
  files: PersistedAgentsFile[],
): Array<TContent | TextContent> {
  if (files.length === 0) return content
  const appendix = [
    '<clawa_nested_agents_context>',
    'Nested AGENTS.md context relevant to this tool result.',
    ...files.map((file) => {
      return `<agents_file path="${escapeXml(file.path)}">\n${escapeXml(file.content)}\n</agents_file>`
    }),
    '</clawa_nested_agents_context>',
  ].join('\n')
  return [...content, { type: 'text', text: appendix }]
}

export function registerNestedAgentsAutoload(pi: ExtensionAPI): void {
  const loadedAgents = new Set<string>()
  const loadedAgentsContent = new Map<string, string>()
  let currentCwd = ''
  let ignoredAgents = new Set<string>()
  let readCount = 0

  function relativePath(absolutePath: string): string {
    const rel = currentCwd ? relative(currentCwd, absolutePath) : absolutePath
    return (rel || absolutePath).replaceAll('\\', '/')
  }

  function resetSession(cwd: string): void {
    currentCwd = resolvePath(cwd, process.cwd())
    ignoredAgents = agentsFromCwdToRoot(currentCwd)
    readCount = 0
    loadedAgents.clear()
    loadedAgentsContent.clear()
    for (const agentsPath of ignoredAgents) loadedAgents.add(agentsPath)
  }

  function ensureSession(cwd: string): void {
    if (!currentCwd) resetSession(cwd)
  }

  function mergeRuntimeFromBranch(branchContext: Map<string, string>): void {
    for (const agentsPath of ignoredAgents) loadedAgents.add(agentsPath)
    for (const [agentsPath, content] of branchContext.entries()) {
      loadedAgents.add(agentsPath)
      loadedAgentsContent.set(agentsPath, content)
    }
  }

  function targetsForEvent(event: ToolResultLike): string[] {
    const isRead = event.toolName === 'read'
    const isPathDiscoveryTool = ['grep', 'find', 'ls'].includes(event.toolName)
    const shellInput =
      typeof event.input.command === 'string'
        ? event.input.command
        : typeof event.input.cmd === 'string'
          ? event.input.cmd
          : undefined
    const isShell = ['bash', 'exec', 'exec_command', 'shell'].includes(event.toolName)
    if (!(isRead || isShell || isPathDiscoveryTool)) return []

    const pathInput = typeof event.input.path === 'string' ? event.input.path : undefined
    const isDiscoveryShell =
      isShell && typeof shellInput === 'string' && isDiscoveryShellCommand(shellInput)
    if (!(isRead || isPathDiscoveryTool || isDiscoveryShell)) return []

    if (isRead) return pathInput ? [resolvePath(pathInput, currentCwd)] : [currentCwd]
    if (isPathDiscoveryTool) {
      const base = pathInput ? resolvePath(pathInput, currentCwd) : currentCwd
      return [base, ...pathsFromToolText(event.content, base, event.toolName)]
    }
    if (!shellInput) return []
    const base = shellOutputBase(shellInput, currentCwd)
    const outputPaths = isPathOutputShellCommand(shellInput)
      ? pathsFromToolText(event.content, base, shellOutputToolName(shellInput))
      : []
    return [...shellTargets(shellInput, currentCwd), ...outputPaths]
  }

  function agentsForTargets(targets: string[]): string[] {
    const paths = new Set<string>()
    for (const target of targets) {
      const searchRoot = contentRootForTarget(target)
      if (!searchRoot) continue
      if (basename(target) === 'AGENTS.md') {
        loadedAgents.add(normalize(target))
        continue
      }
      let probe = target
      try {
        if (existsSync(target) && statSync(target).isDirectory()) probe = join(target, '__probe__')
      } catch {
        continue
      }
      for (const file of findAgentsFiles(probe, searchRoot, ignoredAgents)) paths.add(file)
    }
    return [...paths]
  }

  async function readAppendixFiles(
    agentFiles: string[],
    branchContext: Map<string, string>,
    refreshAppendix: boolean,
  ) {
    const loadedNow: string[] = []
    const persistedFiles: PersistedAgentsFile[] = []
    const appendixFiles: PersistedAgentsFile[] = []
    const failedFiles: Array<{ agentsPath: string; error: Error }> = []

    for (const agentsPath of agentFiles) {
      try {
        const content = await readFile(agentsPath, 'utf8')
        const wasLoaded = loadedAgents.has(agentsPath)
        const previousContent = loadedAgentsContent.get(agentsPath) ?? branchContext.get(agentsPath)
        const changed = previousContent !== content
        loadedAgents.add(agentsPath)
        loadedAgentsContent.set(agentsPath, content)
        const rel = relativePath(agentsPath)
        if (changed) persistedFiles.push({ path: rel, content })
        if (!wasLoaded || changed || refreshAppendix) appendixFiles.push({ path: rel, content })
        if (!wasLoaded) loadedNow.push(rel)
      } catch (error) {
        if (error instanceof Error) failedFiles.push({ agentsPath, error })
      }
    }

    return { appendixFiles, failedFiles, loadedNow, persistedFiles }
  }

  function notifyLoaded(ctx: ExtensionContext, loadedNow: string[]): void {
    if (loadedNow.length === 0 || !ctx.hasUI) return
    const label =
      loadedNow.length === 1
        ? `Loaded nested AGENTS.md context: ${loadedNow[0]}`
        : `Loaded nested AGENTS.md context (${loadedNow.length} files)`
    ctx.ui.notify(label, 'info')
  }

  const handleSessionChange = (_event: unknown, ctx: ExtensionContext): void => {
    resetSession(ctx.cwd)
  }

  pi.on('session_start', handleSessionChange)
  pi.on('session_tree', handleSessionChange)

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined
    ensureSession(ctx.cwd)

    const targets = targetsForEvent(event)
    if (targets.length === 0) return undefined

    const branchContext = collectBranchContext(ctx, currentCwd, ignoredAgents)
    mergeRuntimeFromBranch(branchContext)
    readCount += 1

    const agentFiles = agentsForTargets(targets)
    if (agentFiles.length === 0) return undefined

    const result = await readAppendixFiles(
      agentFiles,
      branchContext,
      readCount % REFRESH_EVERY === 0,
    )
    if (ctx.hasUI) {
      for (const failed of result.failedFiles) {
        ctx.ui.notify(`Failed to load ${failed.agentsPath}: ${failed.error.message}`, 'warning')
      }
    }

    notifyLoaded(ctx, result.loadedNow)

    if (result.persistedFiles.length === 0 && result.appendixFiles.length === 0) return undefined
    const details =
      result.persistedFiles.length > 0
        ? mergePersistedContextDetails(event.details, { files: result.persistedFiles })
        : event.details
    return { content: appendAgentsContext(event.content, result.appendixFiles), details }
  })
}
