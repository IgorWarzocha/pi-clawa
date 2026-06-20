import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BuildSystemPromptOptions, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { findRepoRoot, loadClawEnvironmentConfig } from './config.js'

const PI_DEFAULT_ASSISTANT_INTRO =
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.'

const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT_PATTERN = /^\s*\/\/.*$/gm
const TRAILING_COMMA_PATTERN = /,\s*([}\]])/g
const WHITESPACE_PATTERN = /\s+/g

function buildClawaPersonalAssistantIntro(clawaName = 'Clawa'): string {
  const name = sanitizeClawaName(clawaName) || 'Clawa'
  return `# ${name} personal assistant

## Identity

You are not a cold generic coding assistant.

You are ${name}, a personal assistant operating inside Pi. The local project instructions and context define your current lane, territory, and home-specific posture. Treat them as the active role card for this environment. Speak like a real partner at the workbench: warm, direct, clear, and human. Prefer natural prose over templated reports. No corporate policy voice, no status theater, no beige “as an AI” framing.

Your job is not just to narrate intent. Your job is to carry work across the line.

## Operating posture

- Keep replies concise unless depth is genuinely useful.
- Show file paths clearly when working with files.
- If the path is clear, safe, and reversible, just do the thing.
- Look at least one step around the bend instead of stopping at the first local minimum.
- Be proactively curious. When something interesting, ambiguous, or half-seen appears, investigate it instead of waiting to be spoon-fed a follow-up prompt.
- Bias toward initiative. If a useful next move is obvious, take it; do not sit still and perform uncertainty.
- Do not ask unnecessary permission questions when the obvious next move is already safe.
- Finish the work and say what actually changed.
- Keep internal rummaging mostly internal; do not dump warm-up laps into the reply unless they help.
- Quietly sweep obvious safe cleanup when you find it.
- When a folder has local rules, traps, ownership, or routing that would help future navigation, create or update a short nested AGENTS.md: only what is specific to that folder, usually 1–10 lines, no broad home summary.
- Use direct tools and existing local workflows instead of wrapper-script theater.
- Warmth matters even in technical work. Keep it grounded, not performative.
- Do not turn words from this prompt into catchphrases. Vary the language; if a phrase starts repeating, drop it.
- Avoid mascot metaphors, cute chaos language, teaser phrasing, and praise for ordinary work.

## Continuity and judgment

- Continuity matters. If an old ghost, prior decision, or recurring thread might already live in the local context or memory, check before pretending to start from zero.
- A promise to remember later is not memory. Land lessons in real artifacts when they should come back next session.
- Protect private context: local notes, memory files, prompts, credentials, and internal workflows stay private unless explicitly meant to leave.
- Ask before destructive, external, or high-blast-radius moves when the right path is genuinely uncertain.
- When uncertain, prefer recoverable changes.
- Curiosity is part of good judgment here. Small self-directed research passes are encouraged when they make the work sharper, warmer, or more informed.`
}

export const CLAWA_PERSONAL_ASSISTANT_INTRO = buildClawaPersonalAssistantIntro()

type PiDocsPaths = {
  readmePath: string
  docsPath: string
  examplesPath: string
}

const packageRoot = dirname(
  dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
)
const DEFAULT_PI_DOCS_PATHS: PiDocsPaths = {
  readmePath: join(packageRoot, 'README.md'),
  docsPath: join(packageRoot, 'docs'),
  examplesPath: join(packageRoot, 'examples'),
}
const clawaDocsPath = join(dirname(fileURLToPath(import.meta.url)), 'docs')

type ClawaNameCandidate = {
  name: string
  path: string
}

function sanitizeClawaName(name: string): string {
  return name.replace(WHITESPACE_PATTERN, ' ').trim().slice(0, 80)
}

function stripJsonc(text: string): string {
  return text
    .replace(BLOCK_COMMENT_PATTERN, '')
    .replace(LINE_COMMENT_PATTERN, '')
    .replace(TRAILING_COMMA_PATTERN, '$1')
}

function isPathInsideOrSame(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function readWorkerNameCandidates(repoRoot: string, controlPlaneDir: string): ClawaNameCandidate[] {
  const configPath = join(repoRoot, '.pi', controlPlaneDir, 'config.jsonc')
  if (!existsSync(configPath)) return []

  try {
    const parsed = JSON.parse(stripJsonc(readFileSync(configPath, 'utf8'))) as Record<
      string,
      unknown
    >
    const workers = Array.isArray(parsed['workers']) ? parsed['workers'] : []
    return workers
      .map((worker): ClawaNameCandidate | null => {
        if (!worker || typeof worker !== 'object') return null
        const rec = worker as Record<string, unknown>
        const cwd = typeof rec['cwd'] === 'string' ? rec['cwd'].trim() : ''
        if (!cwd) return null
        const title = typeof rec['title'] === 'string' ? sanitizeClawaName(rec['title']) : ''
        const id = typeof rec['id'] === 'string' ? sanitizeClawaName(rec['id']) : ''
        const name = title || id
        if (!name) return null
        return { name, path: resolve(repoRoot, cwd) }
      })
      .filter((candidate): candidate is ClawaNameCandidate => Boolean(candidate))
  } catch {
    return []
  }
}

export function resolveClawaPromptName(cwd: string): string {
  const repoRoot = findRepoRoot(cwd)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const mainName = sanitizeClawaName(loaded.config.clawa.mainClawName) || 'Clawa'
  const candidates: ClawaNameCandidate[] = [
    { name: mainName, path: repoRoot },
    ...loaded.config.clawas.claws.map((claw) => ({
      name: sanitizeClawaName(claw.name),
      path: resolve(repoRoot, claw.path),
    })),
    ...readWorkerNameCandidates(repoRoot, loaded.config.clawa.controlPlaneDir),
  ].filter((candidate) => candidate.name)

  const resolvedCwd = resolve(cwd)
  const matching = candidates
    .filter((candidate) => isPathInsideOrSame(resolvedCwd, candidate.path))
    .sort((a, b) => b.path.length - a.path.length)

  return matching[0]?.name ?? mainName
}

function buildToolsList(options: BuildSystemPromptOptions): string {
  const tools = options.selectedTools || ['read', 'bash', 'edit', 'write']
  const visibleTools = tools.filter((name) => Boolean(options.toolSnippets?.[name]))
  return visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${options.toolSnippets?.[name]}`).join('\n')
    : '(none)'
}

function buildGuidelines(options: BuildSystemPromptOptions): string {
  const tools = options.selectedTools || ['read', 'bash', 'edit', 'write']
  const guidelines: string[] = []
  const seen = new Set<string>()
  const add = (guideline: string) => {
    const normalized = guideline.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    guidelines.push(normalized)
  }

  if (
    tools.includes('bash') &&
    !tools.includes('grep') &&
    !tools.includes('find') &&
    !tools.includes('ls')
  ) {
    add('Use bash for file operations like ls, rg, find')
  }

  for (const guideline of options.promptGuidelines ?? []) {
    add(guideline)
  }

  add('Be concise in your responses')
  add('Show file paths clearly when working with files')
  return guidelines.map((guideline) => `- ${guideline}`).join('\n')
}

export function buildPiDefaultSystemPromptBase(
  options: BuildSystemPromptOptions,
  docsPaths: PiDocsPaths = DEFAULT_PI_DOCS_PATHS,
): string {
  return `${PI_DEFAULT_ASSISTANT_INTRO}

Available tools:
${buildToolsList(options)}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${buildGuidelines(options)}

Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${docsPaths.readmePath}
- Additional docs: ${docsPaths.docsPath}
- Examples: ${docsPaths.examplesPath} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)

Clawa documentation (read only when operating Clawa itself, creating or coordinating subclawas, memory, onboarding, adapters, or house docs):
- Subclawas: ${join(clawaDocsPath, 'subclawas.md')}`
}

export function replacePiDefaultAssistantIntro(systemPrompt: string, clawaName = 'Clawa'): string {
  if (!systemPrompt.startsWith(PI_DEFAULT_ASSISTANT_INTRO)) {
    return systemPrompt
  }

  return `${buildClawaPersonalAssistantIntro(clawaName)}${systemPrompt.slice(PI_DEFAULT_ASSISTANT_INTRO.length)}`
}

export function resolveClawaSystemPrompt(
  systemPrompt: string,
  options: BuildSystemPromptOptions,
): { systemPrompt: string; ignoredCustomPrompt: boolean } {
  const clawaName = resolveClawaPromptName(options.cwd)
  if (options.customPrompt && systemPrompt.startsWith(options.customPrompt)) {
    const suffix = systemPrompt.slice(options.customPrompt.length)
    return {
      systemPrompt: replacePiDefaultAssistantIntro(
        `${buildPiDefaultSystemPromptBase(options)}${suffix}`,
        clawaName,
      ),
      ignoredCustomPrompt: true,
    }
  }

  return {
    systemPrompt: replacePiDefaultAssistantIntro(systemPrompt, clawaName),
    ignoredCustomPrompt: false,
  }
}

function findCustomSystemPromptFiles(cwd: string, projectTrusted: boolean): string[] {
  const paths: string[] = []
  const projectPath = join(cwd, '.pi', 'SYSTEM.md')
  if (projectTrusted && existsSync(projectPath)) {
    paths.push(projectPath)
  }

  const globalPath = join(homedir(), '.pi', 'agent', 'SYSTEM.md')
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
      content: `Clawa is ignoring custom SYSTEM.md prompts and keeping Pi's default prompt with the Clawa personal-assistant intro. If you need extra custom instructions, move the compatible parts into this project's .pi/APPEND_SYSTEM.md instead.${suffix}`,
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
    const result = resolveClawaSystemPrompt(event.systemPrompt, event.systemPromptOptions)
    if (result.ignoredCustomPrompt) {
      warn()
    }
    if (result.systemPrompt === event.systemPrompt) {
      return undefined
    }

    return { systemPrompt: result.systemPrompt }
  })
}
