import { readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { bootstrapClawWorkspace } from '../bootstrap.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { WorkerDefinition } from '../clawas/types.js'
import { findRepoRoot, loadClawEnvironmentConfig, upsertClawaWorkerConfig } from '../config.js'
import type { CreateClawRequest } from '../gui.js'
import { workerTemplatesDir } from './constants.js'
import { sendDimNote } from './ui-notes.js'

const NON_SLUG_CHARS_REGEX = /[^a-z0-9]+/g
const EDGE_DASH_REGEX = /^-+|-+$/g
const MULTI_DASH_REGEX = /-+/g
const CLAWAS_PLACEHOLDER_LINE_REGEX = /^- \*\*`\[clawa-name\]`\*\* .*$/m
const MAX_SEED_SLUG_CHARS = 56

export async function createNewClaw(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  request: CreateClawRequest,
  runtime?: ClawasRuntime,
) {
  const repoRoot = findRepoRoot(ctx.cwd)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const purpose = request.purpose.trim()
  const seedId = await nextAvailableSeedId(repoRoot, loaded.config.clawas.baseDir, purpose)
  const relativePath = join(loaded.config.clawas.baseDir, seedId)
  const absolutePath = resolve(repoRoot, relativePath)

  await bootstrapClawWorkspace(absolutePath, workerTemplatesDir)
  await symlinkSharedFile(repoRoot, absolutePath, 'HUMAN.md')
  await symlinkSharedFile(repoRoot, absolutePath, 'CLAWAS.md')

  const worker = buildSeedWorker(seedId, relativePath)
  const saved = upsertClawaWorkerConfig(repoRoot, worker)
  await updateClawasMap(repoRoot, seedId, purpose)

  sendDimNote(pi, buildSeedCreatedNote(seedId, purpose, relativePath, saved.path))
  pi.sendUserMessage(buildMainClawaCreatePrompt(seedId, relativePath, purpose), {
    deliverAs: 'followUp',
  })
  await notifySeedWorker(runtime, worker.id, buildWorkerSeedPrompt(seedId, relativePath, purpose))

  if (ctx.hasUI) ctx.ui.notify(`Seeded ${seedId} at ${relativePath}`, 'info')
  return { name: seedId, path: relativePath, workerId: worker.id }
}

function purposeToSlug(purpose: string): string {
  const normalized = purpose
    .toLowerCase()
    .replace(NON_SLUG_CHARS_REGEX, '-')
    .replace(MULTI_DASH_REGEX, '-')
    .replace(EDGE_DASH_REGEX, '')

  const sliced = normalized.slice(0, MAX_SEED_SLUG_CHARS).replace(EDGE_DASH_REGEX, '')
  const lastDash = sliced.lastIndexOf('-')
  const base =
    normalized.length > MAX_SEED_SLUG_CHARS && lastDash > 0
      ? sliced.slice(0, lastDash).replace(EDGE_DASH_REGEX, '')
      : sliced

  const slug = base || 'new-clawa'
  return slug.endsWith('-clawa') ? slug : `${slug}-clawa`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function nextAvailableSeedId(
  repoRoot: string,
  baseDir: string,
  purpose: string,
): Promise<string> {
  const slug = purposeToSlug(purpose)
  const config = loadClawEnvironmentConfig(repoRoot).config
  const existingIds = new Set(
    config.clawas.workers.map((worker) => worker.id).filter((id): id is string => Boolean(id)),
  )

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? slug : `${slug}-${index + 1}`
    const candidatePath = resolve(repoRoot, baseDir, candidate)
    if (!(existingIds.has(candidate) || (await pathExists(candidatePath)))) return candidate
  }

  throw new Error(`Could not find an unused Clawa seed name for ${slug}`)
}

function buildSeedWorker(id: string, cwd: string): WorkerDefinition {
  return {
    id,
    title: id,
    emoji: '🛠️',
    cwd,
    enabled: true,
    autostart: true,
    thinking: 'medium',
  }
}

async function symlinkSharedFile(
  repoRoot: string,
  targetDir: string,
  filename: 'HUMAN.md' | 'CLAWAS.md',
): Promise<void> {
  const linkPath = join(targetDir, filename)
  const targetPath = join(repoRoot, filename)
  const relativeTarget = relative(targetDir, targetPath) || filename
  await rm(linkPath, { force: true })
  await symlink(relativeTarget, linkPath)
}

async function updateClawasMap(repoRoot: string, name: string, purpose: string): Promise<void> {
  const path = join(repoRoot, 'CLAWAS.md')
  let content = ''
  try {
    content = await readFile(path, 'utf8')
  } catch {
    content = '# CLAWAS.md\n\n## House crew\n'
  }

  if (content.includes(`**\`${name}\`**`)) return
  const entry = `- **\`${name}\`** — ${purpose}`
  if (CLAWAS_PLACEHOLDER_LINE_REGEX.test(content)) {
    await writeFile(path, content.replace(CLAWAS_PLACEHOLDER_LINE_REGEX, entry), 'utf8')
    return
  }
  if (content.includes('## House crew')) {
    await writeFile(path, `${content.trimEnd()}\n${entry}\n`, 'utf8')
    return
  }
  await writeFile(path, `${content.trimEnd()}\n\n## House crew\n\n${entry}\n`, 'utf8')
}

function buildSeedCreatedNote(
  name: string,
  purpose: string,
  home: string,
  configPath: string,
): string {
  return [
    `new Clawa seed created: ${name}`,
    `purpose: ${purpose}`,
    `home: ${home}`,
    `config: ${configPath}`,
  ].join('\n')
}

function buildMainClawaCreatePrompt(name: string, path: string, purpose: string): string {
  return [
    'A new specialized Clawa seed has been created.',
    '',
    `Seed name: ${name}`,
    `Home: ${path}`,
    '',
    'Purpose from the human:',
    purpose,
    '',
    'Shape this Clawa now. Chat with the human if the lane needs clarification, then edit its home docs and the root CLAWAS.md routing map as needed. The seed already exists in .pi/claw.jsonc.',
    'Do not turn this into a big wizard. Make a reasonable first draft and let the Clawa evolve.',
  ].join('\n')
}

function buildWorkerSeedPrompt(name: string, path: string, purpose: string): string {
  return [
    'You have just woken up as a specialized Clawa in this house.',
    '',
    `Seed name: ${name}`,
    `Home: ${path}`,
    '',
    'Purpose from the human:',
    purpose,
    '',
    'Your home context is already loaded. Start small: say what lane you think you own, what belongs elsewhere, and what you would shape first. Do not overfill every doc at once; become specific through the onboarding conversation.',
  ].join('\n')
}

async function notifySeedWorker(
  runtime: ClawasRuntime | undefined,
  workerId: string,
  prompt: string,
): Promise<void> {
  if (!runtime) return
  try {
    await runtime.restart()
    await runtime.sendPrompt(workerId, prompt, 'prompt')
  } catch {
    // The main Clawa prompt still tells the household how to finish shaping this seed.
  }
}
