import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { findRepoRoot, markClawEnvironmentBootstrapped } from '../config.js'
import { copyTemplateFiles, findExistingCoreMarkdownFiles } from '../template-files.js'
import { mainTemplatesDir } from './constants.js'
import type { ClawaRuntimeState } from './runtime-state.js'
import { reportBootstrapBlocked, sendDimNote } from './ui-notes.js'

export async function bootstrapMainHome(cwd: string, runtime: ClawaRuntimeState) {
  const conflicts = findExistingCoreMarkdownFiles(cwd)
  if (conflicts.length > 0) {
    return { kind: 'blocked' as const, conflicts }
  }

  const copied = await copyTemplateFiles(mainTemplatesDir, cwd)
  const marked = markClawEnvironmentBootstrapped(findRepoRoot(cwd))
  runtime.markBootstrapped(cwd)

  return { kind: 'complete' as const, copied, markedPath: marked.path }
}

export async function executeBootstrap(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  runtime: ClawaRuntimeState,
) {
  const result = await bootstrapMainHome(ctx.cwd, runtime)
  if (result.kind === 'blocked') {
    reportBootstrapBlocked(pi, ctx, result.conflicts)
    return null
  }

  sendDimNote(
    pi,
    [
      'claw bootstrap complete',
      'claw loaded workspace files:',
      ...result.copied.loadedFiles.map((file) => `- ${file.name} (${file.chars} chars)`),
      `config: ${result.markedPath}`,
    ].join('\n'),
  )

  if (ctx.hasUI) {
    ctx.ui.notify(`Bootstrap complete: ${result.copied.copied.length} created`, 'info')
  }

  return result.copied
}
