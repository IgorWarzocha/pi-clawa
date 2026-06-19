import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { resolveBurrowDefaults } from '../config'
import { parseJsonc } from './jsonc.js'
import type {
  HowabandaConfig,
  WorkerDefinition,
  WorkerPromptProfile,
  WorkerReportMode,
  WorkerThinkingLevel,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value
    .map((entry) => asString(entry)?.trim())
    .filter((entry): entry is string => Boolean(entry))
  return items.length > 0 ? items : undefined
}

function asThinkingLevel(value: unknown): WorkerThinkingLevel | undefined {
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

function asReportMode(value: unknown): WorkerReportMode | undefined {
  if (value === 'auto' || value === 'explicit' || value === 'off') {
    return value
  }
  return undefined
}

function asPromptProfile(value: unknown): WorkerPromptProfile | undefined {
  if (value === 'auto' || value === 'gpt' || value === 'glm' || value === 'discord') {
    return value
  }
  return undefined
}

function normalizeWorker(value: unknown, index: number): WorkerDefinition {
  if (!isRecord(value)) {
    throw new Error(`HOWABANDA worker at index ${index} must be an object`)
  }

  const id = asString(value.id)
  if (!id) {
    throw new Error(`HOWABANDA worker at index ${index} is missing a string id`)
  }

  const cwd = asString(value.cwd) ?? asString(value.workspace)
  if (!cwd) {
    throw new Error(`HOWABANDA worker "${id}" is missing a string cwd/workspace`)
  }

  return {
    id,
    title: asString(value.title) ?? id,
    emoji: asString(value.emoji),
    cwd,
    discordEnabled: asBoolean(value.discordEnabled) ?? false,
    extensions: asStringArray(value.extensions),
    enabled: asBoolean(value.enabled) ?? true,
    autostart: asBoolean(value.autostart) ?? true,
    startupPrompt: asString(value.startupPrompt) ?? asString(value.initialPrompt),
    model: asString(value.model),
    thinking: asThinkingLevel(value.thinking),
    reportMode: asReportMode(value.reportMode),
    promptProfile: asPromptProfile(value.promptProfile) ?? 'auto',
  }
}

function normalizeConfig(value: unknown): HowabandaConfig {
  if (!isRecord(value)) {
    throw new Error('HOWABANDA config must be a JSON object')
  }

  const rawWorkers = value.workers
  if (!Array.isArray(rawWorkers)) {
    throw new Error('HOWABANDA config must define a workers array')
  }

  const workers = rawWorkers
    .map((worker, index) => normalizeWorker(worker, index))
    .filter((worker) => worker.enabled)
  if (workers.length === 0) {
    throw new Error('HOWABANDA config must contain at least one enabled worker')
  }

  return { workers }
}

export function getHowabandaConfigPath(projectRoot: string): string {
  const burrow = resolveBurrowDefaults(projectRoot)
  return path.join(projectRoot, '.pi', burrow.controlPlaneDir, 'config.jsonc')
}

export async function loadHowabandaConfig(projectRoot: string): Promise<HowabandaConfig | null> {
  const configPath = getHowabandaConfigPath(projectRoot)
  let content: string
  try {
    content = await fs.readFile(configPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }

  return normalizeConfig(parseJsonc(content))
}
