import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface ClawaConfig {
  name: string
  emoji?: string | undefined
  path: string
  autostart?: boolean | undefined
  notes?: string | undefined
}

export type ClawaWorkerThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ClawaWorkerReportMode = 'auto' | 'explicit' | 'off'

export interface ClawaWorkerConfig {
  id: string
  title: string
  emoji?: string | undefined
  cwd: string
  discordEnabled?: boolean | undefined
  extensions?: string[] | undefined
  enabled?: boolean | undefined
  autostart?: boolean | undefined
  startupPrompt?: string | undefined
  model?: string | undefined
  thinking?: ClawaWorkerThinkingLevel | undefined
  reportMode?: ClawaWorkerReportMode | undefined
}

export interface ClawaDefaults {
  mainClawName: string
  clawasName: string
  workerSessionPrefix: string
  controlPlaneDir: string
  controlSocketDir: string
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
  mainClawName: 'Clawa',
  clawasName: 'Clawas',
  workerSessionPrefix: 'Clawas',
  controlPlaneDir: 'clawas',
  controlSocketDir: 'clawas-control',
}

export function resolveClawasControlSocketRoot(projectRoot: string): string {
  const runtimeRoot = process.env['XDG_RUNTIME_DIR']?.trim() || tmpdir()
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 16)
  return join(runtimeRoot, 'pi-claw', hash)
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

function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(stripped)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry))
  return items.length > 0 ? items : undefined
}

function asThinkingLevel(value: unknown): ClawaWorkerThinkingLevel | undefined {
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
  return undefined
}

function asReportMode(value: unknown): ClawaWorkerReportMode | undefined {
  if (value === 'auto' || value === 'explicit' || value === 'off') return value
  return undefined
}

function clampWorker(item: unknown): ClawaWorkerConfig | null {
  if (!item || typeof item !== 'object') return null
  const rec = item as Record<string, unknown>
  const id = asString(rec['id'])
  const cwd = asString(rec['cwd']) ?? asString(rec['workspace'])
  if (!(id && cwd)) return null
  return {
    id,
    title: asString(rec['title']) ?? id,
    emoji: asString(rec['emoji']),
    cwd,
    discordEnabled: asBoolean(rec['discordEnabled']),
    extensions: asStringArray(rec['extensions']),
    enabled: asBoolean(rec['enabled']),
    autostart: asBoolean(rec['autostart']),
    startupPrompt: asString(rec['startupPrompt']) ?? asString(rec['initialPrompt']),
    model: asString(rec['model']),
    thinking: asThinkingLevel(rec['thinking']),
    reportMode: asReportMode(rec['reportMode']),
  }
}

function clampWorkers(input: unknown): ClawaWorkerConfig[] {
  if (!Array.isArray(input)) return []
  const out: ClawaWorkerConfig[] = []
  for (const item of input) {
    const worker = clampWorker(item)
    if (worker) out.push(worker)
  }
  return out
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

  try {
    const raw = parseJsonc(readFileSync(path, 'utf8')) as Record<string, unknown>
    const clawas =
      raw['clawas'] && typeof raw['clawas'] === 'object'
        ? (raw['clawas'] as Record<string, unknown>)
        : {}
    return {
      path,
      config: {
        bootstrapped: raw['bootstrapped'] === true,
        clawas: {
          baseDir:
            typeof clawas['baseDir'] === 'string' && clawas['baseDir'].trim()
              ? clawas['baseDir']
              : DEFAULT_CONFIG.clawas.baseDir,
          tmuxSession:
            typeof clawas['tmuxSession'] === 'string' && clawas['tmuxSession'].trim()
              ? clawas['tmuxSession']
              : DEFAULT_CONFIG.clawas.tmuxSession,
          workers: clampWorkers(clawas['workers']),
        },
        clawa: clampClawaDefaults(raw['clawa']),
      },
    }
  } catch {
    return { path, config: DEFAULT_CONFIG }
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

export function isClawEnvironmentBootstrapped(repoRoot: string): boolean {
  return ensureClawEnvironmentConfig(repoRoot).config.bootstrapped === true
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

export function saveClawEnvironmentConfig(repoRoot: string, config: ClawEnvironmentConfig): string {
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
