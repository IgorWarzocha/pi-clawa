import type { ClawaDefaults } from '../config'
import type { WorkerDefinition } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

export interface LaunchOptions {
  definition: WorkerDefinition
  cwd: string
  extensionPaths: string[]
  clawaDefaults: ClawaDefaults
  sessionFile?: string | undefined
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function buildInteractiveCommand(options: LaunchOptions, replaceShell = false): string {
  const args = ['pi']

  if (options.sessionFile?.trim()) {
    args.push('--session', options.sessionFile.trim())
  } else {
    args.push('-c')
  }

  for (const extensionPath of options.extensionPaths) {
    args.push('--extension', extensionPath)
  }
  if (options.definition.model) {
    args.push('--model', options.definition.model)
  }
  if (options.definition.thinking) {
    args.push('--thinking', options.definition.thinking)
  }

  const envVars: Record<string, string> = {
    PI_SKIP_VERSION_CHECK: '1',
    PI_CLAWAS_CONTROL_SOCKET_DIR: options.clawaDefaults.controlSocketDir,
    PI_CLAWAS_ROLE: 'worker',
    PI_CLAWAS_MANUAL_SESSION: '1',
    PI_CLAWAS_WORKER_ID: options.definition.id,
    PI_CLAWAS_WORKER_TITLE: options.definition.title,
    PI_CLAWAS_SOCKET_ALIAS: getWorkerSocketAlias(options.definition),
  }
  if (process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']) {
    envVars['PI_CLAWAS_CONTROL_SOCKET_ROOT'] = process.env['PI_CLAWAS_CONTROL_SOCKET_ROOT']
  }
  if (process.env['PI_CLAW_PROJECT_ROOT']) {
    envVars['PI_CLAW_PROJECT_ROOT'] = process.env['PI_CLAW_PROJECT_ROOT']
  }

  const envPrefix = Object.entries(envVars)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(' ')
  const argString = args.map(shellEscape).join(' ')
  return `${envPrefix} ${replaceShell ? 'exec ' : ''}${argString}`
}

export function sanitizeWindowName(value: string, fallback: string): string {
  return value.replaceAll(/[^A-Za-z0-9:_-]+/g, '-').slice(0, 40) || fallback
}
