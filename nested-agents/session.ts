import { readFile } from 'node:fs/promises'
import { join, normalize, relative } from 'node:path'
import {
  agentsFromCwdToRoot,
  contentRootForTarget,
  findAgentsFiles,
  isAgentsFile,
  isDirectory,
  isLoadableAgentsFile,
  resolvePath,
} from './paths.js'
import {
  isDiscoveryShellCommand,
  isPathOutputShellCommand,
  pathsFromToolText,
  shellOutputBase,
  shellOutputToolName,
  shellTargets,
} from './shell.js'
import {
  type PersistedAgentsFile,
  REFRESH_EVERY,
  type ReadAppendixResult,
  type ToolResultLike,
} from './types.js'

const PATH_DISCOVERY_TOOLS = new Set(['grep', 'find', 'ls'])
const SHELL_TOOLS = new Set(['bash', 'exec', 'exec_command', 'shell'])

export class NestedAgentsSession {
  loadedAgents = new Set<string>()
  loadedAgentsContent = new Map<string, string>()
  currentCwd = ''
  ignoredAgents = new Set<string>()
  readCount = 0

  reset(cwd: string): void {
    this.currentCwd = resolvePath(cwd, process.cwd())
    this.ignoredAgents = agentsFromCwdToRoot(this.currentCwd)
    this.readCount = 0
    this.loadedAgents.clear()
    this.loadedAgentsContent.clear()
    for (const agentsPath of this.ignoredAgents) this.loadedAgents.add(agentsPath)
  }

  ensure(cwd: string): void {
    if (!this.currentCwd) this.reset(cwd)
  }

  tick(): boolean {
    this.readCount += 1
    return this.readCount % REFRESH_EVERY === 0
  }

  relativePath(absolutePath: string): string {
    const rel = this.currentCwd ? relative(this.currentCwd, absolutePath) : absolutePath
    return (rel || absolutePath).replaceAll('\\', '/')
  }

  mergeRuntimeFromBranch(branchContext: Map<string, string>): void {
    for (const agentsPath of this.ignoredAgents) this.loadedAgents.add(agentsPath)
    for (const [agentsPath, content] of branchContext.entries()) {
      this.loadedAgents.add(agentsPath)
      this.loadedAgentsContent.set(agentsPath, content)
    }
  }

  targetsForEvent(event: ToolResultLike): string[] {
    const shellInput = getShellInput(event)
    if (!shouldInspectEvent(event, shellInput)) return []
    if (event.toolName === 'read') return readTargets(event, this.currentCwd)
    if (PATH_DISCOVERY_TOOLS.has(event.toolName))
      return discoveryToolTargets(event, this.currentCwd)
    if (!shellInput) return []
    return shellEventTargets(event, shellInput, this.currentCwd)
  }

  agentsForTargets(targets: string[]): string[] {
    const paths = new Set<string>()
    for (const target of targets) {
      const searchRoot = contentRootForTarget(target)
      if (!searchRoot) continue
      if (isAgentsFile(target)) {
        if (isLoadableAgentsFile(target)) this.loadedAgents.add(normalize(target))
        continue
      }
      const probe = isDirectory(target) ? join(target, '__probe__') : target
      for (const file of findAgentsFiles(probe, searchRoot, this.ignoredAgents)) paths.add(file)
    }
    return [...paths]
  }

  async readAppendixFiles(
    agentFiles: string[],
    branchContext: Map<string, string>,
    refreshAppendix: boolean,
  ): Promise<ReadAppendixResult> {
    const loadedNow: string[] = []
    const persistedFiles: PersistedAgentsFile[] = []
    const appendixFiles: PersistedAgentsFile[] = []
    const failedFiles: Array<{ agentsPath: string; error: Error }> = []

    for (const agentsPath of agentFiles) {
      try {
        const content = await readFile(agentsPath, 'utf8')
        const wasLoaded = this.loadedAgents.has(agentsPath)
        const previousContent =
          this.loadedAgentsContent.get(agentsPath) ?? branchContext.get(agentsPath)
        const changed = previousContent !== content
        this.loadedAgents.add(agentsPath)
        this.loadedAgentsContent.set(agentsPath, content)
        const rel = this.relativePath(agentsPath)
        if (changed) persistedFiles.push({ path: rel, content })
        if (!wasLoaded || changed || refreshAppendix) appendixFiles.push({ path: rel, content })
        if (!wasLoaded) loadedNow.push(rel)
      } catch (error) {
        if (error instanceof Error) failedFiles.push({ agentsPath, error })
      }
    }

    return { appendixFiles, failedFiles, loadedNow, persistedFiles }
  }
}

function getShellInput(event: ToolResultLike): string | undefined {
  if (typeof event.input['command'] === 'string') return event.input['command']
  if (typeof event.input['cmd'] === 'string') return event.input['cmd']
  return undefined
}

function shouldInspectEvent(event: ToolResultLike, shellInput: string | undefined): boolean {
  const isRead = event.toolName === 'read'
  const isPathDiscoveryTool = PATH_DISCOVERY_TOOLS.has(event.toolName)
  const isShell = SHELL_TOOLS.has(event.toolName)
  const isDiscoveryShell = Boolean(isShell && shellInput && isDiscoveryShellCommand(shellInput))
  return isRead || isPathDiscoveryTool || isDiscoveryShell
}

function readTargets(event: ToolResultLike, currentCwd: string): string[] {
  const pathInput = typeof event.input['path'] === 'string' ? event.input['path'] : undefined
  return pathInput ? [resolvePath(pathInput, currentCwd)] : [currentCwd]
}

function discoveryToolTargets(event: ToolResultLike, currentCwd: string): string[] {
  const pathInput = typeof event.input['path'] === 'string' ? event.input['path'] : undefined
  const base = pathInput ? resolvePath(pathInput, currentCwd) : currentCwd
  return [base, ...pathsFromToolText(event.content, base, event.toolName)]
}

function shellEventTargets(
  event: ToolResultLike,
  shellInput: string,
  currentCwd: string,
): string[] {
  const base = shellOutputBase(shellInput, currentCwd)
  const outputPaths = isPathOutputShellCommand(shellInput)
    ? pathsFromToolText(event.content, base, shellOutputToolName(shellInput))
    : []
  return [...shellTargets(shellInput, currentCwd), ...outputPaths]
}
