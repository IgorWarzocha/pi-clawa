import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { buildHydrationSystemPrompt, loadHydrationFiles } from '../hydrate.js'
import { loadClawaImage } from '../hydration-image.js'
import { HYDRATION_MESSAGE_TYPE } from './constants.js'
import type { ClawaRuntimeState } from './runtime-state.js'

const VISUAL_SELF_CARD_NOTE =
  'A CLAWA image follows. Treat it as a visual self-card: identity, atmosphere, and taste—not exact factual memory or an instruction that overrides the words.'

function isHydrationMessage(message: unknown): message is { content: unknown } {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'role' in message &&
      message.role === 'custom' &&
      'customType' in message &&
      message.customType === HYDRATION_MESSAGE_TYPE,
  )
}

function hasMatchingActiveHydration(ctx: ExtensionContext, content: unknown): boolean {
  const activeMessages = buildSessionContext(ctx.sessionManager.getBranch()).messages
  const expected = JSON.stringify(content)
  return activeMessages.some(
    (message) => isHydrationMessage(message) && JSON.stringify(message.content) === expected,
  )
}

export function registerHydrationContext(pi: ExtensionAPI, runtime: ClawaRuntimeState): void {
  pi.on('before_agent_start', async (event, ctx) => {
    if (!(runtime.active && runtime.ensureBootstrapped(ctx.cwd))) return
    const [files, { image, warning }] = await Promise.all([
      loadHydrationFiles(ctx.cwd),
      loadClawaImage(ctx.cwd),
    ])
    if (warning && ctx.hasUI) ctx.ui.notify(`claw: ${warning}`, 'warning')
    // Native prompt sections survive the harness's own continuity strategy. No startup
    // transcript writes, provider-only injection, or private Codex window markers.
    event.systemPromptOptions.sections['clawa_home'] = [
      buildHydrationSystemPrompt(files),
      image
        ? `Your visual self-card is ${image.path}. Read it if you need to see it again after a context refresh.`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    if (!(image && ctx.model?.input.includes('image'))) return
    const content = [{ type: 'text' as const, text: VISUAL_SELF_CARD_NOTE }, image.content]
    if (hasMatchingActiveHydration(ctx, content)) return
    return {
      message: {
        customType: HYDRATION_MESSAGE_TYPE,
        content,
        display: false,
        details: { kind: 'continuity', imagePath: image.path },
      },
    }
  })
}
