import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { buildHydrationSystemPrompt, loadHydrationFiles } from '../hydrate.js'
import { HYDRATION_MESSAGE_TYPE } from './constants.js'
import type { ClawaRuntimeState } from './runtime-state.js'

type HydrationPayload = { kind: 'continuity'; text: string }

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

async function buildHydrationText(
  cwd: string,
  runtime: ClawaRuntimeState,
): Promise<HydrationPayload | null> {
  const bootstrapped = runtime.ensureBootstrapped(cwd)
  if (!bootstrapped) return null

  const files = await loadHydrationFiles(cwd)
  if (files.length === 0) return null
  const contextBlock = buildHydrationSystemPrompt(files)
  return contextBlock.trim() ? { kind: 'continuity', text: contextBlock } : null
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
    if (!runtime.needsHydrate) return undefined

    const baseMessages = Array.isArray(event.messages) ? event.messages : []
    const hydrated = await buildHydrationText(ctx.cwd, runtime)
    runtime.needsHydrate = false
    if (!hydrated) return undefined

    const messages = baseMessages.filter((message) => !isHydrationMessage(message))
    const injected = {
      role: 'custom' as const,
      customType: HYDRATION_MESSAGE_TYPE,
      content: hydrated.text,
      display: false,
      details: { kind: hydrated.kind },
      timestamp: Date.now(),
    }

    if (options.debugProbe && ctx.hasUI) {
      ctx.ui.notify(buildHydrationProbeNote(hydrated.text), 'info')
    }

    return { messages: [...messages, injected] }
  })
}
