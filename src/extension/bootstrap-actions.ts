import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { runBootstrap } from '../bootstrap.js'
import { findRepoRoot, markClawEnvironmentBootstrapped } from '../config.js'
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
