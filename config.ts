import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ClawaConfig {
  name: string
  emoji?: string
  path: string
  autostart?: boolean
  notes?: string
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
    claws: ClawaConfig[]
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

const DEFAULT_CONFIG: ClawEnvironmentConfig = {
  bootstrapped: false,
  clawas: {
    baseDir: 'clawas',
    tmuxSession: 'clawas',
    claws: [],
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

function clampClaws(input: unknown): ClawaConfig[] {
  if (!Array.isArray(input)) return []
  const out: ClawaConfig[] = []
  for (const item of input) {
    const claw = clampClaw(item)
    if (claw) out.push(claw)
  }
  return out
}

function clampClaw(item: unknown): ClawaConfig | null {
  if (!item || typeof item !== 'object') return null
  const rec = item as Record<string, unknown>
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  const path = typeof rec.path === 'string' ? rec.path.trim() : ''
  if (!(name && path)) return null
  return {
    name,
    emoji: typeof rec.emoji === 'string' ? rec.emoji : undefined,
    path,
    autostart: rec.autostart === true,
    notes: typeof rec.notes === 'string' ? rec.notes : undefined,
  }
}

function clampClawaDefaults(input: unknown): ClawaDefaults {
  if (!input || typeof input !== 'object') {
    return DEFAULT_CLAWA_DEFAULTS
  }

  const rec = input as Record<string, unknown>
  const clawasName =
    typeof rec.clawasName === 'string' && rec.clawasName.trim()
      ? rec.clawasName.trim()
      : DEFAULT_CLAWA_DEFAULTS.clawasName
  return {
    mainClawName:
      typeof rec.mainClawName === 'string' && rec.mainClawName.trim()
        ? rec.mainClawName.trim()
        : DEFAULT_CLAWA_DEFAULTS.mainClawName,
    clawasName,
    workerSessionPrefix:
      typeof rec.workerSessionPrefix === 'string' && rec.workerSessionPrefix.trim()
        ? rec.workerSessionPrefix.trim()
        : clawasName,
    controlPlaneDir:
      typeof rec.controlPlaneDir === 'string' && rec.controlPlaneDir.trim()
        ? rec.controlPlaneDir.trim()
        : DEFAULT_CLAWA_DEFAULTS.controlPlaneDir,
    controlSocketDir:
      typeof rec.controlSocketDir === 'string' && rec.controlSocketDir.trim()
        ? rec.controlSocketDir.trim()
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
      raw.clawas && typeof raw.clawas === 'object' ? (raw.clawas as Record<string, unknown>) : {}
    return {
      path,
      config: {
        bootstrapped: raw.bootstrapped === true,
        clawas: {
          baseDir:
            typeof clawas.baseDir === 'string' && clawas.baseDir.trim()
              ? clawas.baseDir
              : DEFAULT_CONFIG.clawas.baseDir,
          tmuxSession:
            typeof clawas.tmuxSession === 'string' && clawas.tmuxSession.trim()
              ? clawas.tmuxSession
              : DEFAULT_CONFIG.clawas.tmuxSession,
          claws: clampClaws(clawas.claws),
        },
        clawa: clampClawaDefaults(raw.clawa),
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

export function upsertClawConfig(
  repoRoot: string,
  claw: ClawaConfig,
): { path: string; config: ClawEnvironmentConfig } {
  const loaded = loadClawEnvironmentConfig(repoRoot)
  const claws = [...loaded.config.clawas.claws]
  const idx = claws.findIndex((item) => item.name === claw.name)
  if (idx >= 0) claws[idx] = claw
  else claws.push(claw)

  const next: ClawEnvironmentConfig = {
    ...loaded.config,
    clawas: {
      ...loaded.config.clawas,
      claws,
    },
  }
  const path = saveClawEnvironmentConfig(repoRoot, next)
  return { path, config: next }
}
