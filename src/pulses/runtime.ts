import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { sendClawasSessionMessage } from '../clawas/comms/client.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { WorkerState } from '../clawas/types.js'
import { getWorkerSocketAlias } from '../clawas/worker-identity.js'
import { discoverPulseDefinitions, type PulseDefinition } from './definitions.js'
import { buildPulseInstruction, CLAWA_PULSE_MESSAGE_TYPE, pulseDetails } from './message.js'
import { isPulseDue, pulseDueKey } from './schedule.js'
import { type PulseSchedulerState, readPulseState, writePulseState } from './state.js'

const PULSE_TICK_MS = 5 * 60 * 1000
const HEY_CLAWA_PULSE_ID = 'hey-clawa'
const HEY_CLAWA_COLLISION_DELAY_MS = 15 * 60 * 1000

type PulseRunMode = 'scheduled' | 'forced'
type DuePulse = { pulse: PulseDefinition; dueKey: string | null }

type PulseWorkerSender = typeof sendClawasSessionMessage

function isWorkerBusy(worker: WorkerState | undefined): boolean {
  return Boolean(
    worker?.manualSession || worker?.status === 'starting' || worker?.status === 'streaming',
  )
}

function findWorker(runtime: ClawasRuntime, workerId: string): WorkerState | undefined {
  return runtime.getState()?.workers.find((worker) => worker.definition.id === workerId)
}

export class PulseRuntime {
  private context: ExtensionContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private readonly pi: ExtensionAPI
  private readonly clawasRuntime: ClawasRuntime
  private readonly sendWorkerSessionMessage: PulseWorkerSender

  constructor(
    pi: ExtensionAPI,
    clawasRuntime: ClawasRuntime,
    sendWorkerSessionMessage: PulseWorkerSender = sendClawasSessionMessage,
  ) {
    this.pi = pi
    this.clawasRuntime = clawasRuntime
    this.sendWorkerSessionMessage = sendWorkerSessionMessage
  }

  attach(context: ExtensionContext): void {
    this.context = context
    this.ensureStarted()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.context = null
  }

  async list(): Promise<PulseDefinition[]> {
    if (!this.context) return []
    return await discoverPulseDefinitions(this.context.cwd)
  }

  async runNow(target: string): Promise<PulseDefinition> {
    const ctx = this.requireContext()
    const pulses = await discoverPulseDefinitions(ctx.cwd)
    const pulse = resolvePulseTarget(pulses, target)
    if (!pulse) throw new Error(`Unknown pulse: ${target}`)
    await this.dispatchPulse(pulse, 'forced')
    return pulse
  }

  async scanAndRunDue(nowMs = Date.now()): Promise<void> {
    if (this.running) return
    const ctx = this.context
    if (!ctx) return

    this.running = true
    try {
      const pulses = await discoverPulseDefinitions(ctx.cwd)
      const state = await readPulseState(ctx.cwd)
      let changed = seedNewPulses(state, pulses, nowMs)

      const duePulses = collectDuePulses(pulses, state, nowMs)
      const delayedHeyPulses = findHeyClawaCollisions(duePulses)
      changed = delayHeyClawaPulses(state, delayedHeyPulses, nowMs) || changed

      for (const { pulse, dueKey } of duePulses) {
        if (delayedHeyPulses.has(pulse)) continue
        const entry = state.pulses[pulse.key]
        await this.dispatchPulse(pulse, 'scheduled')
        state.pulses[pulse.key] = {
          ...entry,
          firstSeenAt: entry?.firstSeenAt ?? nowMs,
          lastRunAt: nowMs,
          lastDueKey: dueKey ?? entry?.lastDueKey,
          deferUntil: undefined,
        }
        changed = true
      }

      if (changed) await writePulseState(ctx.cwd, state)
    } finally {
      this.running = false
    }
  }

  private ensureStarted(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.scanAndRunDue().catch((error) => this.notifyError(error))
    }, PULSE_TICK_MS)
    this.timer.unref?.()
  }

  private async dispatchPulse(pulse: PulseDefinition, mode: PulseRunMode): Promise<void> {
    const forced = mode === 'forced'
    if (pulse.ownerId === 'main') {
      this.sendMainPulse(pulse, forced)
      return
    }
    await this.sendWorkerPulse(pulse, forced)
  }

  private sendMainPulse(pulse: PulseDefinition, forced: boolean): void {
    const ctx = this.requireContext()
    const queued = !ctx.isIdle()
    const instruction = buildPulseInstruction(pulse, { forced, queued })
    this.pi.sendMessage(
      {
        customType: CLAWA_PULSE_MESSAGE_TYPE,
        content: instruction,
        display: true,
        details: pulseDetails(pulse, forced),
      },
      queued ? { triggerTurn: true, deliverAs: 'followUp' } : { triggerTurn: true },
    )
  }

  private async sendWorkerPulse(pulse: PulseDefinition, forced: boolean): Promise<void> {
    await this.clawasRuntime.refreshFromConfig()
    const worker = findWorker(this.clawasRuntime, pulse.ownerId)
    const queued = isWorkerBusy(worker)
    const instruction = buildPulseInstruction(pulse, { forced, queued })
    if (worker?.manualSession) {
      await this.sendWorkerSessionMessage(getWorkerSocketAlias(worker.definition), {
        message: instruction,
        mode: 'followUp',
        sender: { workerId: 'pulse', workerTitle: 'Pulse' },
        kind: 'instruction',
        intent: 'reply_requested',
        visibility: 'worker',
      })
      return
    }
    const mode = queued ? 'followUp' : 'prompt'
    await this.clawasRuntime.sendPrompt(pulse.ownerId, instruction, mode)
  }

  private requireContext(): ExtensionContext {
    if (!this.context) throw new Error('Pulse runtime is not attached')
    return this.context
  }

  private notifyError(error: unknown): void {
    const ctx = this.context
    if (!ctx?.hasUI) return
    ctx.ui.notify(
      `Pulse failed: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}

function collectDuePulses(
  pulses: PulseDefinition[],
  state: PulseSchedulerState,
  nowMs: number,
): DuePulse[] {
  const duePulses: DuePulse[] = []
  for (const pulse of pulses) {
    if (pulse.schedule.kind === 'manual') continue
    const entry = state.pulses[pulse.key]
    if (entry?.deferUntil && nowMs < entry.deferUntil) continue
    const due = isPulseDue({
      schedule: pulse.schedule,
      nowMs,
      firstSeenAt: entry?.firstSeenAt,
      lastRunAt: entry?.lastRunAt,
      lastDueKey: entry?.lastDueKey,
    })
    if (due.due) duePulses.push({ pulse, dueKey: due.dueKey })
  }
  return duePulses
}

function delayHeyClawaPulses(
  state: PulseSchedulerState,
  pulses: Set<PulseDefinition>,
  nowMs: number,
): boolean {
  let changed = false
  for (const pulse of pulses) {
    const entry = state.pulses[pulse.key]
    state.pulses[pulse.key] = {
      ...entry,
      firstSeenAt: entry?.firstSeenAt ?? nowMs,
      deferUntil: nowMs + HEY_CLAWA_COLLISION_DELAY_MS,
    }
    changed = true
  }
  return changed
}

function findHeyClawaCollisions(duePulses: DuePulse[]): Set<PulseDefinition> {
  const byOwner = new Map<string, PulseDefinition[]>()
  for (const { pulse } of duePulses) {
    const group = byOwner.get(pulse.ownerId) ?? []
    group.push(pulse)
    byOwner.set(pulse.ownerId, group)
  }

  const delayed = new Set<PulseDefinition>()
  for (const group of byOwner.values()) {
    if (group.length < 2) continue
    const hasNonHeyPulse = group.some((pulse) => pulse.id !== HEY_CLAWA_PULSE_ID)
    if (!hasNonHeyPulse) continue
    for (const pulse of group) {
      if (pulse.id === HEY_CLAWA_PULSE_ID) delayed.add(pulse)
    }
  }
  return delayed
}

function seedNewPulses(
  state: PulseSchedulerState,
  pulses: PulseDefinition[],
  nowMs: number,
): boolean {
  let changed = false
  const scheduledPulses = pulses.filter((pulse) => pulse.schedule.kind !== 'manual')
  const live = new Set(scheduledPulses.map((pulse) => pulse.key))
  for (const pulse of scheduledPulses) {
    if (state.pulses[pulse.key]) continue
    state.pulses[pulse.key] = {
      firstSeenAt: nowMs,
      lastDueKey: pulseDueKey(pulse.schedule, nowMs) ?? undefined,
    }
    changed = true
  }
  for (const key of Object.keys(state.pulses)) {
    if (live.has(key)) continue
    delete state.pulses[key]
    changed = true
  }
  return changed
}

function resolvePulseTarget(
  pulses: PulseDefinition[],
  target: string,
): PulseDefinition | undefined {
  const normalized = target.trim().toLowerCase()
  return (
    pulses.find((pulse) => pulse.key.toLowerCase() === normalized) ??
    pulses.find((pulse) => pulse.id.toLowerCase() === normalized) ??
    pulses.find((pulse) => pulse.title.toLowerCase() === normalized)
  )
}
