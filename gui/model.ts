import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveSocketPath } from '../clawas/comms/paths.js'
import { getClawasConfigPath, loadClawasConfig } from '../clawas/config-loader.js'
import type { ClawasRuntime } from '../clawas/runtime.js'
import type { WorkerDefinition, WorkerState } from '../clawas/types.js'
import {
  type ClawaConfig,
  findRepoRoot,
  loadClawEnvironmentConfig,
  resolveClawaDefaults,
} from '../config.js'
import { hasAllCoreMarkdownFiles } from '../template-files.js'
import type { ClawItem, ClawStatus, ManagedWorker } from './types.js'

export type ClawGuiModel = {
  repoRoot: string
  clawa: ReturnType<typeof resolveClawaDefaults>
  loaded: ReturnType<typeof loadClawEnvironmentConfig>
  configPath: string
  currentWorkspaceBootstrapped: boolean
  clawItems: ClawItem[]
}

async function getClawStatus(repoRoot: string, claw: ClawaConfig): Promise<ClawStatus> {
  const absPath = resolve(repoRoot, claw.path)
  const exists = existsSync(absPath)
  const bootstrapped = exists ? hasAllCoreMarkdownFiles(absPath) : false
  const socketPath = await resolveSocketPath(claw.name)
  return {
    absPath,
    exists,
    bootstrapped,
    live: Boolean(socketPath),
    socketPath,
  }
}

export function matchesQuery(query: string, ...parts: string[]): boolean {
  return parts.join(' ').toLowerCase().includes(query.toLowerCase())
}

function summarizeWorker(worker: ManagedWorker): string {
  const bits: string[] = [worker.status]
  if (worker.manualSession) bits.push('manual')
  if (worker.currentTask) bits.push(worker.currentTask)
  else if (worker.lastSummary) bits.push(worker.lastSummary)
  return bits.join(' • ')
}

function summarizeClaw(
  claw: ClawaConfig,
  status: ClawStatus,
  worker: ManagedWorker | undefined,
  extraWorkers: number,
): string {
  const bits = [worker ? summarizeWorker(worker) : 'no runner yet']
  if (!status.exists) bits.push('folder missing')
  else if (!status.bootstrapped) bits.push('not bootstrapped')
  if (extraWorkers > 0) bits.push(`+${extraWorkers} more`)
  if (claw.notes) bits.push(claw.notes)
  return bits.join(' • ')
}

function bindWorker(
  repoRoot: string,
  definition: WorkerDefinition,
  liveWorker: WorkerState | undefined,
): { absCwd: string; worker: ManagedWorker } {
  return {
    absCwd: resolve(repoRoot, definition.cwd),
    worker: {
      id: definition.id,
      title: definition.title,
      cwd: definition.cwd,
      status: liveWorker?.status ?? 'stopped',
      manualSession: liveWorker?.manualSession === true,
      autostart: definition.autostart,
      model: definition.model,
      thinking: definition.thinking,
      currentTask: liveWorker?.currentTask,
      lastSummary: liveWorker?.lastSummary,
      lastError: liveWorker?.lastError,
      sessionFile: liveWorker?.sessionFile,
    },
  }
}

function groupWorkersByCwd(
  repoRoot: string,
  definitions: WorkerDefinition[],
  liveWorkers: Map<string, WorkerState>,
): Map<string, ManagedWorker[]> {
  const workersByCwd = new Map<string, ManagedWorker[]>()
  for (const definition of definitions) {
    const binding = bindWorker(repoRoot, definition, liveWorkers.get(definition.id))
    const existing = workersByCwd.get(binding.absCwd) ?? []
    existing.push(binding.worker)
    workersByCwd.set(binding.absCwd, existing)
  }
  return workersByCwd
}

function buildClawItems(
  claws: ClawaConfig[],
  statuses: ClawStatus[],
  workersByCwd: Map<string, ManagedWorker[]>,
): ClawItem[] {
  return claws.map((claw, index) => {
    const status = statuses[index]
    const workers = workersByCwd.get(status.absPath) ?? []
    const primaryWorker = workers[0]
    return {
      name: claw.name,
      summary: summarizeClaw(claw, status, primaryWorker, Math.max(0, workers.length - 1)),
      detailKey: `claw:${claw.name}`,
      status,
      config: claw,
      workers,
    }
  })
}

export async function loadClawGuiModel(cwd: string, runtime: ClawasRuntime): Promise<ClawGuiModel> {
  const repoRoot = findRepoRoot(cwd)
  const clawa = resolveClawaDefaults(repoRoot)
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const clawasConfig = await loadClawasConfig(repoRoot)
  const configPath = getClawasConfigPath(repoRoot)
  const claws = loaded.config.clawas.claws
  const clawStatuses = await Promise.all(claws.map((claw) => getClawStatus(repoRoot, claw)))
  const liveWorkers = new Map(
    (runtime.getState()?.workers ?? []).map((worker) => [worker.definition.id, worker]),
  )
  const workersByCwd = groupWorkersByCwd(repoRoot, clawasConfig?.workers ?? [], liveWorkers)
  return {
    repoRoot,
    clawa,
    loaded,
    configPath,
    currentWorkspaceBootstrapped: loaded.config.bootstrapped === true,
    clawItems: buildClawItems(claws, clawStatuses, workersByCwd),
  }
}
