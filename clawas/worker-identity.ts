import type { ClawaDefaults } from '../config'
import type { WorkerDefinition } from './types.js'

/**
 * Central place for worker-facing names so the daemon, tools, and comms layer
 * all talk about the same worker identity.
 */
export function getWorkerSessionName(
  definition: WorkerDefinition,
  clawaDefaults?: ClawaDefaults,
): string {
  const prefix = clawaDefaults?.workerSessionPrefix ?? 'Clawas'
  return `${prefix} / ${definition.title}`
}

export function getWorkerSocketAlias(definition: WorkerDefinition): string {
  return definition.id
}
