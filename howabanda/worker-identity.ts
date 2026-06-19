import type { BurrowDefaults } from '../config'
import type { WorkerDefinition } from './types.js'

/**
 * Central place for worker-facing names so the daemon, tools, and comms layer
 * all talk about the same worker identity.
 */
export function getWorkerSessionName(
  definition: WorkerDefinition,
  burrowDefaults?: BurrowDefaults,
): string {
  const prefix = burrowDefaults?.workerSessionPrefix ?? 'HOWABANDA'
  return `${prefix} / ${definition.title}`
}

export function getWorkerSocketAlias(definition: WorkerDefinition): string {
  return definition.id
}
