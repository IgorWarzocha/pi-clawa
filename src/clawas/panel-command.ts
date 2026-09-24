import type { ClawaDefaults } from '../config.js'
import { getClawaSessionsDir } from './session-registry.js'
import type { WorkerDefinition } from './types.js'
import { getWorkerSessionName, getWorkerSocketAlias } from './worker-identity.js'

export interface LaunchOptions {
  definition: WorkerDefinition
  cwd: string
  extensionPaths: string[]
  clawaDefaults: ClawaDefaults
  projectRoot: string
  sessionFile: string
}

export function panelArgs(options: LaunchOptions): string[] {
  if (!options.sessionFile.trim()) throw new Error('A worker session file is required')
  const args = [
    '--session',
    options.sessionFile,
    '--session-dir',
    getClawaSessionsDir(options.cwd),
    '--name',
    getWorkerSessionName(options.definition, options.clawaDefaults),
  ]
  for (const path of options.extensionPaths) args.push('--extension', path)
  if (options.definition.model) args.push('--model', options.definition.model)
  if (options.definition.thinking) args.push('--thinking', options.definition.thinking)
  return args
}

export function panelEnvironment(options: LaunchOptions): Record<string, string> {
  const env: Record<string, string> = {
    PI_SKIP_VERSION_CHECK: '1',
    PI_CLAWAS_ROLE: 'worker',
    PI_CLAW_PROJECT_ROOT: options.projectRoot,
    PI_CWD: options.projectRoot,
    PI_CLAWAS_CONTROL_SOCKET_DIR: options.clawaDefaults.controlSocketDir,
    PI_CLAWAS_WORKER_ID: options.definition.id,
    PI_CLAWAS_WORKER_TITLE: options.definition.title,
    PI_CLAWAS_SOCKET_ALIAS: getWorkerSocketAlias(options.definition),
    PI_CLAWAS_REPORT_SESSION_ID: 'main-claw',
  }
  if (process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']) {
    env['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  }
  if (process.env['PI_CODING_AGENT_DIR']) {
    env['PI_CODING_AGENT_DIR'] = process.env['PI_CODING_AGENT_DIR']
  }
  if (options.definition.discordEnabled) env['PI_CLAWAS_DISCORD_ENABLED'] = '1'
  if (options.definition.reportMode) env['PI_CLAWAS_REPORT_MODE'] = options.definition.reportMode
  if (options.definition.fastMode !== undefined) {
    env['PI_CODEX_FAST'] = options.definition.fastMode ? '1' : '0'
  }
  return env
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
