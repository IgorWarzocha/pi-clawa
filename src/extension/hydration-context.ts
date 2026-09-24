import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { buildHydrationSystemPrompt, loadHydrationFiles } from '../hydrate.js'
import { loadClawaImage } from '../hydration-image.js'
import { HYDRATION_MESSAGE_TYPE } from './constants.js'
import type { ClawaRuntimeState } from './runtime-state.js'

type HydrationPayload = {
  image: Awaited<ReturnType<typeof loadClawaImage>>['image']
  imageWarning: string | undefined
  text: string
}

const VISUAL_SELF_CARD_NOTE =
  'A CLAWA image follows. Treat it as a visual self-card: identity, atmosphere, and taste—not exact factual memory or an instruction that overrides the words.'

async function buildHydrationPayload(
  cwd: string,
  runtime: ClawaRuntimeState,
): Promise<HydrationPayload | null> {
  const bootstrapped = runtime.ensureBootstrapped(cwd)
  if (!bootstrapped) return null

  const [files, imageResult] = await Promise.all([loadHydrationFiles(cwd), loadClawaImage(cwd)])
  const contextBlock = buildHydrationSystemPrompt(files).trim()
  if (!(contextBlock || imageResult.image)) return null
  return {
    image: imageResult.image,
    imageWarning: imageResult.warning,
    text: contextBlock || '## Claw Continuity Refresh (auto-loaded)',
  }
}

async function refreshHydration(
  cwd: string,
  runtime: ClawaRuntimeState,
): Promise<string | undefined> {
  if (!runtime.hydrationStale) return
  const hydrated = await buildHydrationPayload(cwd, runtime)
  runtime.hydrationText = hydrated?.text
  runtime.hydrationImage = hydrated?.image
  runtime.hydrationStale = false
  return hydrated?.imageWarning
}

function buildHydrationMessage(runtime: ClawaRuntimeState, includeImage: boolean) {
  if (!runtime.hydrationText) return null
  const image = includeImage ? runtime.hydrationImage : undefined
  const text = image
    ? [runtime.hydrationText, VISUAL_SELF_CARD_NOTE].filter(Boolean).join('\n\n')
    : runtime.hydrationText
  return {
    customType: HYDRATION_MESSAGE_TYPE,
    content: image ? [{ type: 'text' as const, text }, image.content] : text,
    display: false,
    details: {
      kind: 'continuity' as const,
      ...(image ? { imagePath: image.path } : {}),
    },
    timestamp: Date.now(),
  }
}

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
  const persistHydration = async (ctx: ExtensionContext): Promise<void> => {
    if (!runtime.extensionBootstrapped) return undefined
    runtime.ensureBootstrapped(ctx.cwd)
    const warning = await refreshHydration(ctx.cwd, runtime)
    if (warning && ctx.hasUI) ctx.ui.notify(`claw: ${warning}`, 'warning')
    const hydration = buildHydrationMessage(runtime, ctx.model?.input.includes('image') === true)
    if (!hydration || hasMatchingActiveHydration(ctx, hydration.content)) return

    pi.sendMessage(hydration, { triggerTurn: false })
  }

  pi.on('session_start', async (_event, ctx) => {
    await persistHydration(ctx)
  })

  pi.on('session_compact', async (_event, ctx) => {
    await runtime.armHydration(ctx.cwd)
    await persistHydration(ctx)
  })
}
