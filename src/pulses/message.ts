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
  return [
    `Pulse: ${pulse.title}`,
    `Owner: ${pulse.ownerTitle} (${pulse.ownerId})`,
    `Pulse folder: ${pulse.relativeHome}`,
    `Definition file: ${pulse.relativeFile}`,
    forced ? 'Trigger: manual run-now' : `Trigger: schedule ${pulse.scheduleText}`,
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
