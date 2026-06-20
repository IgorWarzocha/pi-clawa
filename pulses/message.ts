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

export function buildPulseInstruction(pulse: PulseDefinition, forced = false): string {
  return [
    `Pulse: ${pulse.title}`,
    `Owner: ${pulse.ownerTitle} (${pulse.ownerId})`,
    `Definition file: ${pulse.relativeFile}`,
    forced ? 'Trigger: manual run-now' : `Trigger: schedule ${pulse.scheduleText}`,
    '',
    'Read the pulse definition file and execute it now.',
    'Also read pulses/AGENTS.md in your home before choosing how to run it; keep the pulse journal tidy if this run teaches anything.',
    'This is a real scheduled Clawa invocation, not a ghost side conversation. Do the work in this session and finish with a concise result message.',
  ].join('\n')
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
