import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { buildHydrationSystemPrompt, loadHydrationFiles } from '../hydrate.js'
import { loadClawaImage } from '../hydration-image.js'
import { HYDRATION_MESSAGE_TYPE } from './constants.js'
import { boundHistoricalImages } from './historical-images.js'
import type { ClawaRuntimeState } from './runtime-state.js'

type HydrationPayload = {
  image: Awaited<ReturnType<typeof loadClawaImage>>['image']
  imageWarning: string | undefined
  text: string
}

type HydrationRefresh = { refreshed: boolean; warning?: string | undefined }

const HYDRATION_MARKERS = [
  ['continuity', '## Claw Continuity Refresh (auto-loaded)'],
  ['CLAW', '--- BEGIN CLAW.md ---'],
  ['HUMAN', '--- BEGIN HUMAN.md ---'],
  ['CLAWAS', '--- BEGIN CLAWAS.md ---'],
  ['CURIOUS', '--- BEGIN CURIOUS.md ---'],
  ['TOOLS', '--- BEGIN TOOLS.md ---'],
  ['sad heading', '## The `sad` State'],
] as const
const BEGIN_BLOCK_REGEX = /--- BEGIN .*? ---/g
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
): Promise<HydrationRefresh> {
  if (!runtime.hydrationStale) return { refreshed: false }
  const hydrated = await buildHydrationPayload(cwd, runtime)
  runtime.hydrationText = hydrated?.text
  runtime.hydrationImage = hydrated?.image
  runtime.hydrationStale = false
  return { refreshed: true, warning: hydrated?.imageWarning }
}

function buildHydrationMessage(runtime: ClawaRuntimeState, includeImage: boolean) {
  if (!runtime.hydrationText) return null
  const image = includeImage ? runtime.hydrationImage : undefined
  const text = image
    ? [runtime.hydrationText, VISUAL_SELF_CARD_NOTE].filter(Boolean).join('\n\n')
    : runtime.hydrationText
  return {
    role: 'custom' as const,
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

function notifyHydrationRefresh(
  ctx: ExtensionContext,
  refresh: HydrationRefresh,
  hydrationText: string | undefined,
  debugProbe: boolean,
): void {
  if (!ctx.hasUI) return
  if (refresh.warning) ctx.ui.notify(`claw: ${refresh.warning}`, 'warning')
  if (debugProbe && refresh.refreshed && hydrationText) {
    ctx.ui.notify(buildHydrationProbeNote(hydrationText), 'info')
  }
}

function buildHydrationProbeNote(text: string): string {
  const found = HYDRATION_MARKERS.filter(([, needle]) => text.includes(needle)).map(
    ([label]) => label,
  )
  const missing = HYDRATION_MARKERS.filter(([, needle]) => !text.includes(needle)).map(
    ([label]) => label,
  )
  const beginBlocks = (text.match(BEGIN_BLOCK_REGEX) || []).length

  return [
    'claw hydration probe:',
    `- payload chars: ${text.length}`,
    `- BEGIN blocks: ${beginBlocks}`,
    `- found: ${found.length > 0 ? found.join(', ') : 'none'}`,
    `- missing: ${missing.length > 0 ? missing.join(', ') : 'none'}`,
  ].join('\n')
}

function isHydrationMessage(message: unknown): boolean {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'role' in message &&
      message.role === 'custom' &&
      'customType' in message &&
      message.customType === HYDRATION_MESSAGE_TYPE,
  )
}

export function registerHydrationContext(
  pi: ExtensionAPI,
  runtime: ClawaRuntimeState,
  options: { debugProbe: boolean },
): void {
  pi.on('session_compact', async (_event, ctx) => {
    await runtime.armHydration(ctx.cwd)
    if (options.debugProbe && ctx.hasUI) {
      ctx.ui.notify('claw: workspace context will reload on the next turn.', 'info')
    }
  })

  pi.on('context', async (event, ctx) => {
    if (!runtime.extensionBootstrapped) return undefined
    runtime.ensureBootstrapped(ctx.cwd)

    const baseMessages = Array.isArray(event.messages) ? event.messages : []
    const withoutHydration = baseMessages.filter((message) => !isHydrationMessage(message))
    const messages = boundHistoricalImages(withoutHydration)
    const contextChanged =
      withoutHydration.length !== baseMessages.length || messages !== withoutHydration
    const refresh = await refreshHydration(ctx.cwd, runtime)
    notifyHydrationRefresh(ctx, refresh, runtime.hydrationText, options.debugProbe)
    const injected = buildHydrationMessage(runtime, ctx.model?.input.includes('image') === true)
    if (!injected) {
      return contextChanged ? { messages } : undefined
    }

    // Context transforms are non-persistent. Reapply one cached hydration block to every
    // provider call so tool loops keep their continuity without accumulating copies.
    return { messages: [injected, ...messages] }
  })
}
