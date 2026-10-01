import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAgentDir, type ModelRegistry } from '@earendil-works/pi-coding-agent'
import type { ClawaDefaults } from '../config.js'
import { getClawaSessionsDir } from './session-registry.js'
import type { WorkerDefinition } from './types.js'
import { getWorkerSessionName, getWorkerSocketAlias } from './worker-identity.js'

// Terminal hosts inherit their daemon's environment, not the launching Pi's.
// Keep this scoped to launch/auth/network settings. The host owns terminal and session identity.
const WORKER_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'SHELL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'PI_CODING_AGENT_DIR',
  'PI_OFFLINE',
  'PI_CODEX_FAST',
  'PI_CLAWAS_CONTROL_SOCKET_ROOT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_BASE_URL',
  'AZURE_OPENAI_RESOURCE_NAME',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_DEPLOYMENT_NAME_MAP',
  'ANT_LING_API_KEY',
  'QWEN_TOKEN_PLAN_API_KEY',
  'QWEN_TOKEN_PLAN_CN_API_KEY',
  'NVIDIA_API_KEY',
  'DEEPSEEK_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_CLOUD_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'XAI_API_KEY',
  'RADIUS_API_KEY',
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_API_KEY',
  'ZAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
  'MISTRAL_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'MOONSHOT_API_KEY',
  'HF_TOKEN',
  'FIREWORKS_API_KEY',
  'TOGETHER_API_KEY',
  'BASETEN_API_KEY',
  'OPENCODE_API_KEY',
  'KIMI_API_KEY',
  'META_API_KEY',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_GATEWAY_ID',
  'XIAOMI_API_KEY',
  'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  'COPILOT_GITHUB_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_BEDROCK_SKIP_AUTH',
  'AWS_BEDROCK_FORCE_HTTP1',
  'AWS_BEDROCK_FORCE_CACHE',
] as const

const ENV_REFERENCE = /\$(?:\$|!|\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/gu
const HOST_IDENTITY =
  /^(?:HERDR_|SHEPHERDR_|TMUX(?:_|$)|TERM(?:_|$)|PI_(?:CLAW|CODEX|SESSION)|(?:PWD|OLDPWD|WINDOWID|STY|SHLVL|SSH_TTY)$)/u
type ProviderRegistry = Pick<
  ModelRegistry,
  'getRegisteredProviderIds' | 'getRegisteredProviderConfig'
>

function collectEnvironmentReferences(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(ENV_REFERENCE)) {
      const key = match[1] ?? match[2]
      if (key && !HOST_IDENTITY.test(key)) keys.add(key)
    }
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectEnvironmentReferences(child, keys)
  }
}

/** Discover references, never resolve credentials or execute provider commands in the launcher. */
export async function configuredProviderEnvironmentKeys(
  registry?: ProviderRegistry,
): Promise<string[]> {
  const keys = new Set<string>()
  let config: string | undefined
  try {
    config = await readFile(join(getAgentDir(), 'models.json'), 'utf8')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new Error('Cannot read Pi models.json for worker environment forwarding')
  }
  if (config !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(config)
    } catch {
      // JSON parser diagnostics can quote literal credentials from the source.
      throw new Error('Invalid Pi models.json; fix its syntax before launching a worker')
    }
    collectEnvironmentReferences(parsed, keys)
  }
  for (const id of registry?.getRegisteredProviderIds() ?? [])
    collectEnvironmentReferences(registry?.getRegisteredProviderConfig(id), keys)
  return [...keys]
}

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

export function panelEnvironment(
  options: LaunchOptions,
  source: NodeJS.ProcessEnv = process.env,
  providerKeys: string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of [...WORKER_ENVIRONMENT_KEYS, ...providerKeys]) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  Object.assign(env, {
    PI_SKIP_VERSION_CHECK: '1',
    PI_CLAWAS_ROLE: 'worker',
    PI_CLAW_PROJECT_ROOT: options.projectRoot,
    PI_CWD: options.projectRoot,
    PI_CLAWAS_CONTROL_SOCKET_DIR: options.clawaDefaults.controlSocketDir,
    PI_CLAWAS_WORKER_ID: options.definition.id,
    PI_CLAWAS_WORKER_TITLE: options.definition.title,
    PI_CLAWAS_SOCKET_ALIAS: getWorkerSocketAlias(options.definition),
    PI_CLAWAS_REPORT_SESSION_ID: 'main-claw',
  })
  if (options.definition.reportMode) env['PI_CLAWAS_REPORT_MODE'] = options.definition.reportMode
  if (options.definition.fastMode !== undefined) {
    env['PI_CODEX_FAST'] = options.definition.fastMode ? '1' : '0'
  }
  return env
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
