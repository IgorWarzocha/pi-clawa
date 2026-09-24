import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { sendClawasSessionMessage } from '../clawas/comms/client.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { WorkerState } from '../clawas/types.js'
import { getWorkerSocketAlias } from '../clawas/worker-identity.js'
import { discoverPulseDefinitions, type PulseDefinition } from './definitions.js'
import { buildPulseInstruction, CLAWA_PULSE_MESSAGE_TYPE, pulseDetails } from './message.js'
import { isPulseDue, isPulseQuietAt, pulseDueKey } from './schedule.js'
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
  private epoch = 0
  private readonly active = new Set<Promise<unknown>>()
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
    this.epoch += 1
    this.context = context
    this.ensureStarted()
  }

  async dispose(): Promise<void> {
    this.epoch += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.context = null
    await Promise.allSettled([...this.active])
  }

  async list(): Promise<PulseDefinition[]> {
    if (!this.context) return []
    return await discoverPulseDefinitions(this.context.cwd)
  }

  runNow(target: string): Promise<PulseDefinition> {
    const ctx = this.requireContext()
    const epoch = this.epoch
    return this.track(this.runForced(ctx, epoch, target))
  }

  private async runForced(
    ctx: ExtensionContext,
    epoch: number,
    target: string,
  ): Promise<PulseDefinition> {
    const pulses = await discoverPulseDefinitions(ctx.cwd)
    if (this.epoch !== epoch) throw new Error('Pulse session changed before delivery')
    const pulse = resolvePulseTarget(pulses, target)
    if (!pulse) throw new Error(`Unknown pulse: ${target}`)
    if (!(await this.dispatchPulse(pulse, 'forced', Date.now(), epoch))) {
      throw new Error('Pulse session changed before delivery')
    }
    return pulse
  }

  scanAndRunDue(nowMs = Date.now()): Promise<void> {
    if (this.running) return Promise.resolve()
    const ctx = this.context
    if (!ctx) return Promise.resolve()

    this.running = true
    return this.track(this.scanDue(ctx, this.epoch, nowMs))
  }

  private async scanDue(ctx: ExtensionContext, epoch: number, nowMs: number): Promise<void> {
    try {
      const pulses = await discoverPulseDefinitions(ctx.cwd)
      const state = await readPulseState(ctx.cwd)
      if (this.epoch !== epoch) return
      let changed = seedNewPulses(state, pulses, nowMs)

      const duePulses = collectDuePulses(pulses, state, nowMs)
      const delayedHeyPulses = findHeyClawaCollisions(duePulses)
      changed = delayHeyClawaPulses(state, delayedHeyPulses, nowMs) || changed
      if (changed) await writePulseState(ctx.cwd, state)

      for (const { pulse, dueKey } of duePulses) {
        if (this.epoch !== epoch) break
        if (delayedHeyPulses.has(pulse)) continue
        const entry = state.pulses[pulse.key]
        if (!(await this.dispatchPulse(pulse, 'scheduled', nowMs, epoch))) break
        // A delivery already in flight may finish during shutdown. Persist it before exiting.
        state.pulses[pulse.key] = {
          ...entry,
          firstSeenAt: entry?.firstSeenAt ?? nowMs,
          lastRunAt: nowMs,
          lastDueKey: dueKey ?? entry?.lastDueKey,
          deferUntil: undefined,
        }
        // Checkpoint each successful delivery so a later pulse failure cannot replay it.
        await writePulseState(ctx.cwd, state)
      }
    } finally {
      this.running = false
    }
  }

  private track<T>(work: Promise<T>): Promise<T> {
    this.active.add(work)
    void work.then(
      () => this.active.delete(work),
      () => this.active.delete(work),
    )
    return work
  }

  private ensureStarted(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.scanAndRunDue().catch((error) => this.notifyError(error))
    }, PULSE_TICK_MS)
    this.timer.unref?.()
  }

  private async dispatchPulse(
    pulse: PulseDefinition,
    mode: PulseRunMode,
    nowMs: number,
    epoch: number,
  ): Promise<boolean> {
    if (this.epoch !== epoch) return false
    const forced = mode === 'forced'
    if (pulse.ownerId === 'main') {
      await this.sendMainPulse(pulse, forced, nowMs)
      return true
    }
    return await this.sendWorkerPulse(pulse, forced, nowMs, epoch)
  }

  private async sendMainPulse(
    pulse: PulseDefinition,
    forced: boolean,
    nowMs: number,
  ): Promise<void> {
    const ctx = this.requireContext()
    const queued = !ctx.isIdle()
    const instruction = buildPulseInstruction(pulse, { forced, queued, nowMs })
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

  private async sendWorkerPulse(
    pulse: PulseDefinition,
    forced: boolean,
    nowMs: number,
    epoch: number,
  ): Promise<boolean> {
    await this.clawasRuntime.refreshFromConfig()
    if (this.epoch !== epoch) return false
    const worker = findWorker(this.clawasRuntime, pulse.ownerId)
    const queued = isWorkerBusy(worker)
    const instruction = buildPulseInstruction(pulse, { forced, queued, nowMs })
    if (worker?.manualSession) {
      await this.sendWorkerSessionMessage(getWorkerSocketAlias(worker.definition), {
        message: instruction,
        mode: 'followUp',
        sender: { workerId: 'pulse', workerTitle: 'Pulse' },
        kind: 'instruction',
        intent: 'reply_requested',
        visibility: 'worker',
      })
      return true
    }
    const mode = queued ? 'followUp' : 'prompt'
    await this.clawasRuntime.sendPrompt(pulse.ownerId, instruction, mode)
    return true
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
    if (!pulse.enabled) continue
    if (pulse.schedule.kind === 'manual') continue
    if (pulse.quietHours && isPulseQuietAt(pulse.quietHours, nowMs)) continue
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
  const enabledScheduledPulses = scheduledPulses.filter((pulse) => pulse.enabled)
  const live = new Set(enabledScheduledPulses.map((pulse) => pulse.key))
  for (const pulse of enabledScheduledPulses) {
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
  const pulse =
    pulses.find((candidate) => candidate.key.toLowerCase() === normalized) ??
    pulses.find((candidate) => candidate.id.toLowerCase() === normalized) ??
    pulses.find((candidate) => candidate.title.toLowerCase() === normalized)
  if (pulse && !pulse.enabled) throw new Error(`Pulse is disabled: ${pulse.key}`)
  return pulse
}
