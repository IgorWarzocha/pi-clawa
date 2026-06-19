import { rm, symlink } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { bootstrapClawWorkspace, runBootstrap } from '../bootstrap.js'
import {
  type ClawaConfig,
  findRepoRoot,
  loadClawEnvironmentConfig,
  markClawEnvironmentBootstrapped,
  upsertClawConfig,
} from '../config.js'
import type { CreateClawRequest } from '../gui.js'
import { findExistingCoreMarkdownFiles } from '../template-files.js'
import { mainTemplatesDir } from './constants.js'
import type { ClawaRuntimeState } from './runtime-state.js'
import { reportBootstrapBlocked, sendDimNote } from './ui-notes.js'

export async function executeBootstrap(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  runtime: ClawaRuntimeState,
) {
  const conflicts = findExistingCoreMarkdownFiles(ctx.cwd)
  if (conflicts.length > 0) {
    reportBootstrapBlocked(pi, ctx, conflicts)
    return null
  }

  const result = await runBootstrap(ctx.cwd, mainTemplatesDir)
  runtime.markBootstrapped(ctx.cwd)
  const marked = markClawEnvironmentBootstrapped(findRepoRoot(ctx.cwd))

  sendDimNote(
    pi,
    [
      'claw bootstrap complete',
      'claw loaded workspace files:',
      ...result.loadedFiles.map((file) => `- ${file.name} (${file.chars} chars)`),
      `config: ${marked.path}`,
    ].join('\n'),
  )

  if (ctx.hasUI) {
    ctx.ui.notify(
      `Bootstrap complete: ${result.created} created, ${result.overwritten} overwritten`,
      'info',
    )
  }

  return result
}

export async function createNewClaw(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  request: CreateClawRequest,
) {
  const repoRoot = findRepoRoot(ctx.cwd)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const safeName = request.name.trim()
  const relativePath = join(loaded.config.clawas.baseDir, safeName)
  const absolutePath = resolve(repoRoot, relativePath)
  await bootstrapClawWorkspace(absolutePath, mainTemplatesDir)
  await symlinkSharedClawasFile(repoRoot, absolutePath)

  const claw: ClawaConfig = {
    name: safeName,
    path: relativePath,
    autostart: false,
  }
  const saved = upsertClawConfig(repoRoot, claw)

  sendDimNote(
    pi,
    [`new claw created: ${safeName}`, `path: ${relativePath}`, `config: ${saved.path}`].join('\n'),
  )

  if (ctx.hasUI) {
    ctx.ui.notify(`Created ${safeName} at ${relativePath}`, 'info')
  }

  return { name: safeName, path: relativePath }
}

async function symlinkSharedClawasFile(repoRoot: string, targetDir: string): Promise<void> {
  const linkPath = join(targetDir, 'CLAWAS.md')
  const targetPath = join(repoRoot, 'CLAWAS.md')
  const relativeTarget = relative(targetDir, targetPath) || 'CLAWAS.md'
  await rm(linkPath, { force: true })
  await symlink(relativeTarget, linkPath)
}
