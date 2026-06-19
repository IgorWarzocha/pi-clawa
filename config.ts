import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface BandaClawConfig {
  name: string
  emoji?: string
  path: string
  autostart?: boolean
  notes?: string
}

export interface BurrowDefaults {
  mainClawName: string
  bandaName: string
  workerSessionPrefix: string
  controlPlaneDir: string
  controlSocketDir: string
}

export interface HowabouaClawConfig {
  bootstrapped: boolean
  banda: {
    baseDir: string
    tmuxSession: string
    claws: BandaClawConfig[]
  }
  burrow: BurrowDefaults
}

export const DEFAULT_BURROW_DEFAULTS: BurrowDefaults = {
  mainClawName: 'Howaclawa',
  bandaName: 'HOWABANDA',
  workerSessionPrefix: 'HOWABANDA',
  controlPlaneDir: 'howabanda',
  controlSocketDir: 'howabanda-control',
}

const DEFAULT_CONFIG: HowabouaClawConfig = {
  bootstrapped: false,
  banda: {
    baseDir: 'banda',
    tmuxSession: 'howabanda',
    claws: [],
  },
  burrow: DEFAULT_BURROW_DEFAULTS,
}

function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(stripped)
}

function clampClaws(input: unknown): BandaClawConfig[] {
  if (!Array.isArray(input)) return []
  const out: BandaClawConfig[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    const path = typeof rec.path === 'string' ? rec.path.trim() : ''
    if (!(name && path)) continue
    out.push({
      name,
      emoji: typeof rec.emoji === 'string' ? rec.emoji : undefined,
      path,
      autostart: rec.autostart === true,
      notes: typeof rec.notes === 'string' ? rec.notes : undefined,
    })
  }
  return out
}

function clampBurrowDefaults(input: unknown): BurrowDefaults {
  if (!input || typeof input !== 'object') {
    return DEFAULT_BURROW_DEFAULTS
  }

  const rec = input as Record<string, unknown>
  const bandaName =
    typeof rec.bandaName === 'string' && rec.bandaName.trim()
      ? rec.bandaName.trim()
      : DEFAULT_BURROW_DEFAULTS.bandaName
  return {
    mainClawName:
      typeof rec.mainClawName === 'string' && rec.mainClawName.trim()
        ? rec.mainClawName.trim()
        : DEFAULT_BURROW_DEFAULTS.mainClawName,
    bandaName,
    workerSessionPrefix:
      typeof rec.workerSessionPrefix === 'string' && rec.workerSessionPrefix.trim()
        ? rec.workerSessionPrefix.trim()
        : bandaName,
    controlPlaneDir:
      typeof rec.controlPlaneDir === 'string' && rec.controlPlaneDir.trim()
        ? rec.controlPlaneDir.trim()
        : DEFAULT_BURROW_DEFAULTS.controlPlaneDir,
    controlSocketDir:
      typeof rec.controlSocketDir === 'string' && rec.controlSocketDir.trim()
        ? rec.controlSocketDir.trim()
        : DEFAULT_BURROW_DEFAULTS.controlSocketDir,
  }
}

export function findRepoRoot(startCwd: string): string {
  let current = startCwd
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return startCwd
    current = parent
  }
}

export function getHowabouaClawConfigPath(repoRoot: string): string {
  return join(repoRoot, '.pi', 'howaboua-claw.jsonc')
}

export function loadHowabouaClawConfig(repoRoot: string): {
  path: string
  config: HowabouaClawConfig
} {
  const path = getHowabouaClawConfigPath(repoRoot)
  if (!existsSync(path)) {
    return { path, config: DEFAULT_CONFIG }
  }

  try {
    const raw = parseJsonc(readFileSync(path, 'utf8')) as Record<string, unknown>
    const banda =
      raw.banda && typeof raw.banda === 'object' ? (raw.banda as Record<string, unknown>) : {}
    return {
      path,
      config: {
        bootstrapped: raw.bootstrapped === true,
        banda: {
          baseDir:
            typeof banda.baseDir === 'string' && banda.baseDir.trim()
              ? banda.baseDir
              : DEFAULT_CONFIG.banda.baseDir,
          tmuxSession:
            typeof banda.tmuxSession === 'string' && banda.tmuxSession.trim()
              ? banda.tmuxSession
              : DEFAULT_CONFIG.banda.tmuxSession,
          claws: clampClaws(banda.claws),
        },
        burrow: clampBurrowDefaults(raw.burrow),
      },
    }
  } catch {
    return { path, config: DEFAULT_CONFIG }
  }
}

export function resolveBurrowDefaults(startCwd: string): BurrowDefaults {
  return loadHowabouaClawConfig(findRepoRoot(startCwd)).config.burrow
}

export function ensureHowabouaClawConfig(repoRoot: string): {
  path: string
  config: HowabouaClawConfig
  created: boolean
} {
  const path = getHowabouaClawConfigPath(repoRoot)
  if (existsSync(path)) {
    const loaded = loadHowabouaClawConfig(repoRoot)
    return { ...loaded, created: false }
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
  return { path, config: DEFAULT_CONFIG, created: true }
}

export function isHowabouaClawEnvironmentBootstrapped(repoRoot: string): boolean {
  return ensureHowabouaClawConfig(repoRoot).config.bootstrapped === true
}

export function markHowabouaClawEnvironmentBootstrapped(repoRoot: string): {
  path: string
  config: HowabouaClawConfig
} {
  const loaded = ensureHowabouaClawConfig(repoRoot)
  const next = { ...loaded.config, bootstrapped: true }
  const path = saveHowabouaClawConfig(repoRoot, next)
  return { path, config: next }
}

export function saveHowabouaClawConfig(repoRoot: string, config: HowabouaClawConfig): string {
  const path = getHowabouaClawConfigPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return path
}

export function upsertClawConfig(
  repoRoot: string,
  claw: BandaClawConfig,
): { path: string; config: HowabouaClawConfig } {
  const loaded = loadHowabouaClawConfig(repoRoot)
  const claws = [...loaded.config.banda.claws]
  const idx = claws.findIndex((item) => item.name === claw.name)
  if (idx >= 0) claws[idx] = claw
  else claws.push(claw)

  const next: HowabouaClawConfig = {
    ...loaded.config,
    banda: {
      ...loaded.config.banda,
      claws,
    },
  }
  const path = saveHowabouaClawConfig(repoRoot, next)
  return { path, config: next }
}
