import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseJsonc } from './jsonc.js'

export interface ClawaConfig {
  name: string
  emoji?: string | undefined
  path: string
  autostart?: boolean | undefined
  notes?: string | undefined
}

export type ClawaWorkerThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
type ClawaWorkerReportMode = 'auto' | 'explicit' | 'off'

export interface ClawaWorkerConfig {
  id: string
  title: string
  emoji?: string | undefined
  cwd: string
  discordEnabled?: boolean | undefined
  extensions?: string[] | undefined
  enabled: boolean
  autostart: boolean
  startupPrompt?: string | undefined
  model?: string | undefined
  thinking?: ClawaWorkerThinkingLevel | undefined
  reportMode?: ClawaWorkerReportMode | undefined
}

export interface ClawaMemoryPassConfig {
  enabled: boolean
  triggerPercent: number
}

export interface ClawaDefaults {
  humanName: string
  mainClawName: string
  clawasName: string
  workerSessionPrefix: string
  controlPlaneDir: string
  controlSocketDir: string
  memoryPass: ClawaMemoryPassConfig
}

const DEFAULT_CLAWA_MEMORY_PASS_CONFIG: ClawaMemoryPassConfig = {
  enabled: true,
  triggerPercent: 90,
}

export interface ClawEnvironmentConfig {
  bootstrapped: boolean
  clawas: {
    baseDir: string
    tmuxSession: string
    workers: ClawaWorkerConfig[]
  }
  clawa: ClawaDefaults
}

export const DEFAULT_CLAWA_DEFAULTS: ClawaDefaults = {
  humanName: 'human',
  mainClawName: 'Clawa',
  clawasName: 'Clawas',
  workerSessionPrefix: 'Clawas',
  controlPlaneDir: 'clawas',
  controlSocketDir: 'clawas-control',
  memoryPass: DEFAULT_CLAWA_MEMORY_PASS_CONFIG,
}

export function resolveClawasControlSocketRoot(projectRoot: string): string {
  const runtimeRoot = process.env['XDG_RUNTIME_DIR']?.trim() || tmpdir()
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)
  return join(runtimeRoot, 'pi-clawa', hash)
}

const DEFAULT_CONFIG: ClawEnvironmentConfig = {
  bootstrapped: false,
  clawas: {
    baseDir: 'clawas',
    tmuxSession: 'clawas',
    workers: [],
  },
  clawa: DEFAULT_CLAWA_DEFAULTS,
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function asStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of strings`)
  const items = value.map((entry) => asString(entry))
  if (items.some((entry) => entry === undefined)) {
    throw new Error(`${label} must contain non-empty strings`)
  }
  const strings = items.filter((entry): entry is string => entry !== undefined)
  return strings.length > 0 ? strings : undefined
}

function asThinkingLevel(value: unknown, label: string): ClawaWorkerThinkingLevel | undefined {
  if (value === undefined) return undefined
  if (
    value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  throw new Error(`${label} must be off, minimal, low, medium, high, or xhigh`)
}

function asReportMode(value: unknown, label: string): ClawaWorkerReportMode | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'explicit' || value === 'off') return value
  throw new Error(`${label} must be auto, explicit, or off`)
}

function normalizeWorker(item: unknown, index: number): ClawaWorkerConfig {
  const rec = asRecord(item, `clawas.workers[${index}]`)
  const id = asString(rec['id'])
  const cwd = asString(rec['cwd']) ?? asString(rec['workspace'])
  if (!id) throw new Error(`clawas.workers[${index}] is missing a string id`)
  if (!cwd) throw new Error(`clawas.workers[${index}] is missing a string cwd`)
  const label = `clawas.workers[${index}]`
  return {
    id,
    title: asString(rec['title']) ?? id,
    emoji: asString(rec['emoji']),
    cwd,
    discordEnabled: asBoolean(rec['discordEnabled'], `${label}.discordEnabled`) ?? false,
    extensions: asStringArray(rec['extensions'], `${label}.extensions`),
    enabled: asBoolean(rec['enabled'], `${label}.enabled`) ?? true,
    autostart: asBoolean(rec['autostart'], `${label}.autostart`) ?? true,
    startupPrompt: asString(rec['startupPrompt']) ?? asString(rec['initialPrompt']),
    model: asString(rec['model']),
    thinking: asThinkingLevel(rec['thinking'], `${label}.thinking`),
    reportMode: asReportMode(rec['reportMode'], `${label}.reportMode`),
  }
}

function normalizeWorkers(input: unknown): ClawaWorkerConfig[] {
  if (!Array.isArray(input)) throw new Error('clawas.workers must be an array')
  const workers = input.map(normalizeWorker)
  const ids = new Set<string>()
  for (const worker of workers) {
    const normalizedId = worker.id.toLowerCase()
    if (ids.has(normalizedId)) throw new Error(`Duplicate Clawas worker id: ${worker.id}`)
    ids.add(normalizedId)
  }
  return workers
}

function normalizeMemoryPassConfig(input: unknown): ClawaMemoryPassConfig {
  if (input === undefined) return { ...DEFAULT_CLAWA_MEMORY_PASS_CONFIG }

  const rec = asRecord(input, '.pi/claw.jsonc clawa.memoryPass')
  const enabled = rec['enabled'] ?? DEFAULT_CLAWA_MEMORY_PASS_CONFIG.enabled
  const triggerPercent = rec['triggerPercent'] ?? DEFAULT_CLAWA_MEMORY_PASS_CONFIG.triggerPercent

  if (typeof enabled !== 'boolean') {
    throw new Error('.pi/claw.jsonc clawa.memoryPass.enabled must be a boolean')
  }
  if (
    typeof triggerPercent !== 'number' ||
    !Number.isSafeInteger(triggerPercent) ||
    triggerPercent <= 0 ||
    triggerPercent >= 100
  ) {
    throw new Error(
      '.pi/claw.jsonc clawa.memoryPass.triggerPercent must be an integer from 1 to 99',
    )
  }

  return {
    enabled,
    triggerPercent,
  }
}

function clampClawaDefaults(input: unknown): ClawaDefaults {
  if (!input || typeof input !== 'object') {
    return DEFAULT_CLAWA_DEFAULTS
  }

  const rec = input as Record<string, unknown>
  const clawasName =
    typeof rec['clawasName'] === 'string' && rec['clawasName'].trim()
      ? rec['clawasName'].trim()
      : DEFAULT_CLAWA_DEFAULTS.clawasName
  return {
    humanName:
      typeof rec['humanName'] === 'string' && rec['humanName'].trim()
        ? rec['humanName'].trim()
        : DEFAULT_CLAWA_DEFAULTS.humanName,
    mainClawName:
      typeof rec['mainClawName'] === 'string' && rec['mainClawName'].trim()
        ? rec['mainClawName'].trim()
        : DEFAULT_CLAWA_DEFAULTS.mainClawName,
    clawasName,
    workerSessionPrefix:
      typeof rec['workerSessionPrefix'] === 'string' && rec['workerSessionPrefix'].trim()
        ? rec['workerSessionPrefix'].trim()
        : clawasName,
    controlPlaneDir:
      typeof rec['controlPlaneDir'] === 'string' && rec['controlPlaneDir'].trim()
        ? rec['controlPlaneDir'].trim()
        : DEFAULT_CLAWA_DEFAULTS.controlPlaneDir,
    controlSocketDir:
      typeof rec['controlSocketDir'] === 'string' && rec['controlSocketDir'].trim()
        ? rec['controlSocketDir'].trim()
        : DEFAULT_CLAWA_DEFAULTS.controlSocketDir,
    memoryPass: normalizeMemoryPassConfig(rec['memoryPass']),
  }
}

export function findRepoRoot(startCwd: string): string {
  let current = startCwd
  while (true) {
    if (
      existsSync(join(current, '.git')) ||
      existsSync(join(current, '.pi', 'claw.jsonc')) ||
      existsSync(join(current, '.pi', 'settings.json'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return startCwd
    current = parent
  }
}

export function getClawEnvironmentConfigPath(repoRoot: string): string {
  return join(repoRoot, '.pi', 'claw.jsonc')
}

export function loadClawEnvironmentConfig(repoRoot: string): {
  path: string
  config: ClawEnvironmentConfig
} {
  const path = getClawEnvironmentConfigPath(repoRoot)
  if (!existsSync(path)) {
    return { path, config: DEFAULT_CONFIG }
  }

  const raw = asRecord(parseJsonc(readFileSync(path, 'utf8')), '.pi/claw.jsonc')
  const clawas = asRecord(raw['clawas'], '.pi/claw.jsonc clawas')
  return {
    path,
    config: {
      bootstrapped: raw['bootstrapped'] === true,
      clawas: {
        baseDir: asString(clawas['baseDir']) ?? DEFAULT_CONFIG.clawas.baseDir,
        tmuxSession: asString(clawas['tmuxSession']) ?? DEFAULT_CONFIG.clawas.tmuxSession,
        workers: normalizeWorkers(clawas['workers']),
      },
      clawa: clampClawaDefaults(raw['clawa']),
    },
  }
}

export function resolveClawaDefaults(startCwd: string): ClawaDefaults {
  return loadClawEnvironmentConfig(findRepoRoot(startCwd)).config.clawa
}

export function ensureClawEnvironmentConfig(repoRoot: string): {
  path: string
  config: ClawEnvironmentConfig
  created: boolean
} {
  const path = getClawEnvironmentConfigPath(repoRoot)
  if (existsSync(path)) {
    const loaded = loadClawEnvironmentConfig(repoRoot)
    return { ...loaded, created: false }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
  return { path, config: DEFAULT_CONFIG, created: true }
}

export function markClawEnvironmentBootstrapped(repoRoot: string): {
  path: string
  config: ClawEnvironmentConfig
} {
  const loaded = ensureClawEnvironmentConfig(repoRoot)
  const next = { ...loaded.config, bootstrapped: true }
  const path = saveClawEnvironmentConfig(repoRoot, next)
  return { path, config: next }
}

function saveClawEnvironmentConfig(repoRoot: string, config: ClawEnvironmentConfig): string {
  const path = getClawEnvironmentConfigPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return path
}

export function upsertClawaWorkerConfig(
  repoRoot: string,
  worker: ClawaWorkerConfig,
): { path: string; config: ClawEnvironmentConfig } {
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const workers = [...loaded.config.clawas.workers]
  const idx = workers.findIndex((item) => item.id === worker.id)
  if (idx >= 0) workers[idx] = worker
  else workers.push(worker)

  const next: ClawEnvironmentConfig = {
    ...loaded.config,
    clawas: {
      ...loaded.config.clawas,
      workers,
    },
  }
  const path = saveClawEnvironmentConfig(repoRoot, next)
  return { path, config: next }
}
