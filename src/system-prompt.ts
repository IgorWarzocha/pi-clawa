import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  type BuildSystemPromptOptions,
  type ExtensionAPI,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'
import { findRepoRoot, loadClawEnvironmentConfig } from './config.js'

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

function filterClawaHomeContextFiles(
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
  const repoRoot = process.env['PI_CLAW_PROJECT_ROOT']?.trim() || findRepoRoot(cwd)
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

export function registerClawaSystemPrompt(pi: ExtensionAPI, isActive: () => boolean): void {
  let warnedCustomSystemPrompt = false
  pi.on('before_agent_start', (event, ctx) => {
    if (!isActive()) return
    const options = event.systemPromptOptions
    options.contextFiles = filterClawaHomeContextFiles(options.contextFiles, options.cwd)
    options.sections['clawa_identity'] = buildClawaPersonalAssistantIntro(
      resolveClawaPromptName(options.cwd),
    )
    // Do not fight another extension's prompt owner. Opaque overrides cannot compose sections.
    if (options.forceSystemPrompt !== undefined && !warnedCustomSystemPrompt && ctx.hasUI) {
      warnedCustomSystemPrompt = true
      ctx.ui.notify(
        'A full prompt override hides Clawa home instructions. Use structured prompt sections or .pi/APPEND_SYSTEM.md to keep home context.',
        'warning',
      )
    }
  })
}
