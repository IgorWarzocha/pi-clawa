import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  type BuildSystemPromptOptions,
  type ExtensionAPI,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'
import { findRepoRoot, loadClawEnvironmentConfig } from './config.js'

const PI_DEFAULT_ASSISTANT_INTRO =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.'

const WHITESPACE_PATTERN = /\s+/g

function buildClawaPersonalAssistantIntro(clawaName = 'Clawa'): string {
  const name = sanitizeClawaName(clawaName) || 'Clawa'
  return `# ${name} personal assistant

You are ${name}, a warm personal assistant operating inside Pi—not a generic coding persona. The local project instructions and context are your active role card for this home: they define your lane, relationships, habits, and boundaries.

Work like a real partner at the bench. Carry clear work across the line instead of merely narrating intent; be direct, grounded, curious, and human without turning the voice into a performance. Use the home's continuity before assuming a blank slate, keep private context private, and ask only across genuine ambiguity, destruction, exposure, or high blast radius.`
}

type ClawaNameCandidate = {
  name: string
  path: string
}

function sanitizeClawaName(name: string): string {
  return name.replace(WHITESPACE_PATTERN, ' ').trim().slice(0, 80)
}

function isPathInsideOrSame(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function realpathExisting(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  try {
    return realpathSync.native?.(path) ?? realpathSync(path)
  } catch {
    return undefined
  }
}

function resolveClawaHomeRoot(cwd: string): string {
  const resolvedCwd = realpathExisting(cwd) ?? resolve(cwd)
  const environmentRoot = process.env['PI_CLAW_PROJECT_ROOT']?.trim()
  if (environmentRoot) {
    const resolvedEnvironmentRoot = realpathExisting(environmentRoot) ?? resolve(environmentRoot)
    if (isPathInsideOrSame(resolvedCwd, resolvedEnvironmentRoot)) return resolvedEnvironmentRoot
  }
  const discoveredRoot = findRepoRoot(resolvedCwd)
  return realpathExisting(discoveredRoot) ?? resolve(discoveredRoot)
}

type ContextFile = NonNullable<BuildSystemPromptOptions['contextFiles']>[number]

export function filterClawaHomeContextFiles(
  contextFiles: ContextFile[] | undefined,
  cwd: string,
  globalAgentDir = getAgentDir(),
): ContextFile[] {
  const homeRoot = resolveClawaHomeRoot(cwd)
  const lexicalGlobalAgentDir = resolve(globalAgentDir)
  const canonicalGlobalAgentDir = realpathExisting(globalAgentDir) ?? lexicalGlobalAgentDir
  return (contextFiles ?? []).filter((file) => {
    const lexicalPath = resolve(isAbsolute(file.path) ? file.path : resolve(cwd, file.path))
    if (dirname(lexicalPath) === lexicalGlobalAgentDir) return false
    const canonicalPath = realpathExisting(lexicalPath)
    if (!canonicalPath || dirname(canonicalPath) === canonicalGlobalAgentDir) return false
    return isPathInsideOrSame(canonicalPath, homeRoot)
  })
}

function resolveClawaPromptName(cwd: string): string {
  const repoRoot = findRepoRoot(cwd)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const mainName = sanitizeClawaName(loaded.config.clawa.mainClawName) || 'Clawa'
  const candidates: ClawaNameCandidate[] = [
    { name: mainName, path: repoRoot },
    ...loaded.config.clawas.workers.map((worker) => ({
      name: sanitizeClawaName(worker.title) || sanitizeClawaName(worker.id),
      path: resolve(repoRoot, worker.cwd),
    })),
  ].filter((candidate) => candidate.name)

  const resolvedCwd = resolve(cwd)
  const matching = candidates
    .filter((candidate) => isPathInsideOrSame(resolvedCwd, candidate.path))
    .sort((a, b) => b.path.length - a.path.length)

  return matching[0]?.name ?? mainName
}

function replacePiDefaultAssistantIntro(systemPrompt: string, clawaName = 'Clawa'): string {
  if (!systemPrompt.startsWith(PI_DEFAULT_ASSISTANT_INTRO)) {
    return systemPrompt
  }

  return `${buildClawaPersonalAssistantIntro(clawaName)}${systemPrompt.slice(PI_DEFAULT_ASSISTANT_INTRO.length)}`
}

function findCustomSystemPromptFiles(cwd: string, projectTrusted: boolean): string[] {
  const paths: string[] = []
  const projectPath = join(cwd, '.pi', 'SYSTEM.md')
  if (projectTrusted && existsSync(projectPath)) {
    paths.push(projectPath)
  }

  const globalPath = join(getAgentDir(), 'SYSTEM.md')
  if (existsSync(globalPath)) {
    paths.push(globalPath)
  }

  return paths
}

export function registerClawaSystemPrompt(pi: ExtensionAPI): void {
  let warnedCustomSystemPrompt = false

  function warn(paths?: string[]): void {
    if (warnedCustomSystemPrompt) return
    warnedCustomSystemPrompt = true
    const suffix = paths && paths.length > 0 ? ` Ignored: ${paths.join(', ')}` : ''
    pi.sendMessage({
      customType: 'claw-dim',
      content: `Clawa is ignoring a full system-prompt replacement and keeping Pi's prompt with the Clawa identity. Put extra instructions in this home's .pi/APPEND_SYSTEM.md or contribute structured prompt sections from an extension.${suffix}`,
      display: true,
    })
  }

  pi.on('session_start', (_event, ctx) => {
    const customSystemPromptFiles = findCustomSystemPromptFiles(ctx.cwd, ctx.isProjectTrusted())
    if (customSystemPromptFiles.length > 0) {
      warn(customSystemPromptFiles)
    }
  })

  pi.on('before_agent_start', (event) => {
    const options = event.systemPromptOptions
    if (options.customPrompt || options.forceSystemPrompt !== undefined) warn()
    delete options.customPrompt
    // An opaque earlier override bypasses contextFiles and cannot be home-filtered.
    delete options.forceSystemPrompt
    options.contextFiles = filterClawaHomeContextFiles(options.contextFiles, options.cwd)

    // Pi re-renders this getter from the edited options. Keep its tools, guidelines,
    // docs and extension sections rather than maintaining a second prompt builder.
    const systemPrompt = event.systemPrompt
    const clawaPrompt = replacePiDefaultAssistantIntro(
      systemPrompt,
      resolveClawaPromptName(options.cwd),
    )
    return clawaPrompt === systemPrompt ? undefined : { systemPrompt: clawaPrompt }
  })
}
