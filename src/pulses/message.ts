import type { PulseDefinition } from './definitions.js'

export const CLAWA_PULSE_MESSAGE_TYPE = 'clawa-pulse'

export interface PulseMessageDetails {
  pulseId: string
  pulseTitle: string
  ownerId: string
  ownerTitle: string
  file: string
  forced?: boolean | undefined
}

export interface PulseInstructionOptions {
  forced?: boolean | undefined
  queued?: boolean | undefined
  nowMs?: number | undefined
}

function formatPulseWakeTime(nowMs: number): string {
  const now = new Date(nowMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  const offsetMinutes = -now.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60))
  const offsetRemainder = pad(Math.abs(offsetMinutes) % 60)
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} UTC${offsetSign}${offsetHours}:${offsetRemainder} (${timeZone})`
}

function queuedPulseLines(queued: boolean): string[] {
  if (!queued) return []
  return [
    'This pulse arrived while active work was already in flight.',
    'Do not task-switch. Finish the current human/clawa request first.',
    'When that is done, say this pulse is waiting and ask if they are happy for you to run it now. Run it only after they agree.',
  ]
}

export function buildPulseInstruction(
  pulse: PulseDefinition,
  options: PulseInstructionOptions = {},
): string {
  const forced = options.forced === true
  const queued = options.queued === true
  const nowMs = options.nowMs ?? Date.now()
  return [
    `Pulse: ${pulse.title}`,
    `Owner: ${pulse.ownerTitle} (${pulse.ownerId})`,
    `Wake time: ${formatPulseWakeTime(nowMs)}`,
    `Pulse folder: ${pulse.relativeHome}`,
    `Definition file: ${pulse.relativeFile}`,
    forced ? 'Trigger: manual run-now' : `Trigger: schedule ${pulse.scheduleText}`,
    pulse.quietHoursText
      ? `Quiet hours: ${pulse.quietHoursText} local time${forced ? ' (manual run-now bypass)' : ''}`
      : null,
    '',
    ...queuedPulseLines(queued),
    queued ? '' : null,
    queued
      ? 'After they agree, execute the pulse definition.'
      : 'Execute the pulse definition now.',
    'Relevant pulse context is already loaded; keep the pulse notes/journal tidy if this run teaches anything.',
    queued
      ? 'This is a real scheduled Clawa invocation, not a ghost side conversation. When you do run it, do the work in this session and finish with a concise result message.'
      : 'This is a real scheduled Clawa invocation, not a ghost side conversation. Do the work in this session and finish with a concise result message.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function pulseDetails(pulse: PulseDefinition, forced = false): PulseMessageDetails {
  return {
    pulseId: pulse.id,
    pulseTitle: pulse.title,
    ownerId: pulse.ownerId,
    ownerTitle: pulse.ownerTitle,
    file: pulse.relativeFile,
    forced,
  }
}
