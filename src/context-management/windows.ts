import { randomUUID } from 'node:crypto'
import type {
  CustomEntryDraft,
  ExtensionAPI,
  ExtensionContext,
  SessionBoundaryDraft,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { ClawaDefaults } from '../config.js'
import { hydrationDraft } from '../extension/hydration-context.js'
import type { ClawaRuntimeState } from '../extension/runtime-state.js'
import { MemoryPass } from './memory-pass.js'

const WINDOW_TYPE = 'clawa-context-window'
const HINT_TYPE = 'clawa-context-hint'

interface WindowIdentity {
  windowId: string
  agentName: string
}

export function currentWindow(branch: readonly SessionEntry[]): WindowIdentity | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry?.type === 'compaction') return undefined
    if (entry?.type !== 'custom' || entry.customType !== WINDOW_TYPE) continue
    const data = entry.data
    if (
      !data ||
      typeof data !== 'object' ||
      !('windowId' in data) ||
      typeof data.windowId !== 'string' ||
      !('agentName' in data) ||
      typeof data.agentName !== 'string'
    )
      throw new Error('Invalid persisted Clawa context window')
    return { windowId: data.windowId, agentName: data.agentName }
  }
  return undefined
}

function marker(identity: WindowIdentity): CustomEntryDraft {
  return { type: 'custom', customType: WINDOW_TYPE, data: identity }
}

function windowHint(identity: WindowIdentity, chatId: string, rootHouse: string): string {
  return [
    `Clawa local context window: ${identity.windowId}. Chat: ${chatId}. Agent: ${identity.agentName}.`,
    `Shared durable memory is ${rootHouse}/memory/. All Clawas in this house share it.`,
    'notes defaults to chat-local working notes; scope:"memory" reads or edits shared Markdown.',
    'Use notes action:"list_files_by_prefix" with file_order_by:"updated_at" and file_order:"descending" to find your latest checkpoint, then read_file to restore it. Relative note paths belong to you; <agent>/notes/path addresses another agent in this chat, and chat_id selects another known house chat.',
    'history lists and searches earlier windows and house chats, including tool results. Search before reading whole transcripts. scope:"memory" searches shared files, conversations, and committed memory revisions.',
    'Before new_context, save the active request, decisions, exact paths/history IDs, progress, and next actions in notes. Carry deferred ideas as notes, not as permission to implement them.',
    'new_context starts a fresh window after the current tool batch. No hidden summary is invented; the full conversation remains in Pi history. Read your checkpoint and continue without making the human repeat themselves.',
    'Use shared memory for durable understanding, not task scratchpads. Living identity and human documents keep their existing ownership. Search before writing, update rather than duplicate, and leave uncertainty visible.',
    'When replacing a shared file, pass expected_version from read_file so a sibling edit cannot be overwritten silently. Use null for create-only writes; on conflict, reread and merge. Append operations serialize automatically.',
  ].join('\n')
}

export function rolloverDrafts(
  identity: WindowIdentity,
  chatId: string,
  rootHouse: string,
): SessionBoundaryDraft[] {
  return [
    {
      type: 'compaction',
      // Pi's native self-retaining boundary cuts model context, not stored history.
      summary: windowHint(identity, chatId, rootHouse),
      firstKeptEntryId: null,
      details: { strategy: 'clawa-notes-only', windowId: identity.windowId },
    },
    marker(identity),
  ]
}

export function registerContextWindows(
  pi: ExtensionAPI,
  options: {
    getDefaults: (ctx: ExtensionContext) => ClawaDefaults
    getAccess: (ctx: ExtensionContext) => { rootHouse: string; agentName: string }
    isReady: () => boolean
    runtime: ClawaRuntimeState
  },
): void {
  const pass = new MemoryPass()
  let pending: { chatId: string; identity: WindowIdentity } | undefined
  const initialize = (ctx: ExtensionContext): void => {
    if (!options.isReady() || options.getDefaults(ctx).contextManagement !== 'local') return
    const branch = ctx.sessionManager.getBranch()
    if (currentWindow(branch)) return
    const access = options.getAccess(ctx)
    const identity = { windowId: randomUUID(), agentName: access.agentName }
    pi.appendEntry(WINDOW_TYPE, identity)
    pi.sendMessage(
      {
        customType: HINT_TYPE,
        content: windowHint(identity, ctx.sessionManager.getSessionId(), access.rootHouse),
        display: false,
      },
      { triggerTurn: false },
    )
  }

  pi.on('session_start', (_event, ctx) => {
    pending = undefined
    pass.restore(ctx.sessionManager.getBranch())
    initialize(ctx)
  })
  pi.on('session_tree', (_event, ctx) => {
    pending = undefined
    pass.restore(ctx.sessionManager.getBranch())
    initialize(ctx)
  })
  pi.on('session_compact', (_event, ctx) => {
    pending = undefined
    pass.rearm()
    initialize(ctx)
  })
  pi.on('session_before_compact', (event, ctx) => {
    // Local owns normal window turnover; manual requests and overflow still belong to Pi.
    if (
      options.isReady() &&
      options.getDefaults(ctx).contextManagement === 'local' &&
      event.reason === 'threshold'
    )
      return { cancel: true }
  })

  pi.registerTool({
    name: 'new_context',
    label: 'New context',
    description:
      'Start a fresh local context window after this tool batch. Save a checkpoint in notes first; history and notes survive.',
    parameters: Type.Object({}),
    async execute(_id, _params, signal, _update, ctx) {
      signal?.throwIfAborted()
      if (options.getDefaults(ctx).contextManagement !== 'local') {
        throw new Error(
          'Local context is disabled; clawa.contextManagement is "pi". Use Pi compaction instead.',
        )
      }
      if (pending) throw new Error('A new context window is already scheduled for this tool batch')
      const identity = { windowId: randomUUID(), agentName: options.getAccess(ctx).agentName }
      pending = { chatId: ctx.sessionManager.getSessionId(), identity }
      return {
        content: [
          {
            type: 'text',
            text: 'Fresh context scheduled after this tool batch. Restore your notes there and continue.',
          },
        ],
        details: { scheduled: true, window_id: identity.windowId },
      }
    },
  })

  pi.registerTool({
    name: 'get_context_remaining',
    label: 'Context remaining',
    description: 'Check active-model context usage and the current local window.',
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      const usage = ctx.getContextUsage()
      const result = {
        window_id: currentWindow(ctx.sessionManager.getBranch())?.windowId ?? null,
        tokens: usage?.tokens ?? null,
        context_window: usage?.contextWindow ?? null,
        remaining_tokens:
          usage?.tokens == null ? null : Math.max(0, usage.contextWindow - usage.tokens),
        percent: usage?.percent ?? null,
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
    },
  })

  pi.on('turn_end', async (event, ctx) => {
    const requested = pending
    pending = undefined
    if (!requested && options.isReady()) {
      const defaults = options.getDefaults(ctx)
      if (defaults.contextManagement !== 'local') return
      const draft = pass.request(defaults.memoryPass, ctx.getContextUsage(), event.outcome, 'local')
      if (draft) return { entries: [...event.entries, draft], continue: true }
      return
    }
    if (
      !requested ||
      event.outcome !== 'completed' ||
      requested.chatId !== ctx.sessionManager.getSessionId()
    )
      return
    const drafts = rolloverDrafts(
      requested.identity,
      requested.chatId,
      options.getAccess(ctx).rootHouse,
    )
    const hydration = await hydrationDraft(ctx, options.runtime)
    if (hydration) drafts.push(hydration)
    pass.rearm()
    return { entries: [...drafts, ...event.entries], continue: true }
  })

  pi.on('agent_before_settle', (event, ctx) => {
    if (!options.isReady()) return
    const defaults = options.getDefaults(ctx)
    const draft = pass.request(
      defaults.memoryPass,
      ctx.getContextUsage(),
      event.outcome,
      defaults.contextManagement,
    )
    if (!draft) return
    return { entries: [...event.entries, draft], continue: true }
  })
  pi.on('agent_settled', () => {
    pending = undefined
  })
}
