import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import {
  parseBooleanSetting,
  parseEnumSetting,
  parseIntegerSetting,
  readEnvFile,
} from '../shared/env.js';

export const DEFAULT_PI_BIN = 'pi';
export const DEFAULT_CHANNEL_POLICY = 'open-trigger' as const;

const DEFAULT_PROJECT_ROOT = process.env['PI_CWD']?.trim() || process.cwd();
const DEFAULT_CONFIG_PATH = resolve(DEFAULT_PROJECT_ROOT, '.pi/clawa-discord/config.env');
const DEFAULT_DATA_DIR = resolve(DEFAULT_PROJECT_ROOT, '.pi/clawa-discord');
const LEGACY_ENV_PATH = resolve(process.cwd(), '.env');
const CONFIG_SOURCE = buildConfigSource();

export function resolveConfigPath(): string {
  const configuredPath = process.env['PI_CLAWA_DISCORD_CONFIG']?.trim() ?? '';
  if (configuredPath) {
    return resolveUserPath(configuredPath);
  }

  return DEFAULT_CONFIG_PATH;
}

function resolveUserPath(inputPath: string): string {
  const expanded = expandHome(inputPath.trim());
  return isAbsolute(expanded) ? expanded : resolve(DEFAULT_PROJECT_ROOT, expanded);
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return homedir();
  }

  if (inputPath.startsWith('~/')) {
    return resolve(homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function readEnvValue(key: string): string | undefined {
  return CONFIG_SOURCE[key];
}

function buildConfigSource(): Record<string, string> {
  return {
    ...readEnvFile(LEGACY_ENV_PATH),
    ...readEnvFile(resolveConfigPath()),
    ...readProcessEnv(),
  };
}

function readProcessEnv(): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      values[key] = value;
    }
  }

  return values;
}

function env(key: string, fallback = ''): string {
  return (readEnvValue(key) ?? '').trim() || fallback;
}

function envInt(key: string, fallback: number, opts: { min?: number } = {}): number {
  return parseIntegerSetting(CONFIG_SOURCE, key, fallback, opts);
}

function envBool(key: string, fallback: boolean): boolean {
  return parseBooleanSetting(CONFIG_SOURCE, key, fallback);
}

const VALID_CHANNEL_POLICIES = ['open', 'open-trigger', 'allowlist'] as const;
type ChannelPolicy = typeof VALID_CHANNEL_POLICIES[number];

function parseChannelPolicy(value: string): ChannelPolicy {
  return parseEnumSetting(
    { CHANNEL_POLICY: value },
    'CHANNEL_POLICY',
    DEFAULT_CHANNEL_POLICY,
    VALID_CHANNEL_POLICIES,
  );
}

export const config = {
  /** Discord bot token (required) */
  discordToken: env('DISCORD_BOT_TOKEN'),

  /** Pi binary path */
  piBin: env('PI_BIN', DEFAULT_PI_BIN),

  /** SQLite database path */
  dbPath: resolveUserPath(env('DB_PATH', resolve(DEFAULT_DATA_DIR, 'gateway.db'))),

  /** Agent-editable Discord channel -> Clawa worker routes */
  routesPath: resolveUserPath(env('ROUTES_PATH', resolve(DEFAULT_DATA_DIR, 'routes.jsonc'))),

  /** Agent-readable snapshot of Discord channels the gateway has seen */
  channelsPath: resolveUserPath(env('CHANNELS_PATH', resolve(DEFAULT_DATA_DIR, 'channels.json'))),

  /** Local cache for Discord attachments so normal Pi tools can inspect them */
  assetsDir: resolveUserPath(env('ASSETS_DIR', resolve(DEFAULT_DATA_DIR, 'assets'))),

  /** Days of local media assets to keep; links.md indexes are never culled */
  attachmentsRetentionDays: envInt('ATTACHMENTS_RETENTION_DAYS', 7, { min: 1 }),

  /** Bot trigger name (default: bot's own display name) */
  triggerName: env('TRIGGER_NAME', 'pi'),

  /** Extra wake words that should trigger the bot when used as standalone words */
  triggerAliases: env('TRIGGER_ALIASES', 'claw,clawa').split(',').map((s) => s.trim()).filter(Boolean),

  /** Max concurrent agent invocations */
  maxConcurrency: envInt('MAX_CONCURRENCY', 3, { min: 1 }),

  /** Poll interval for message queue (ms) */
  pollInterval: envInt('POLL_INTERVAL_MS', 1000, { min: 1 }),

  /** Graceful shutdown timeout before aborting in-flight tasks (ms) */
  shutdownTimeoutMs: envInt('SHUTDOWN_TIMEOUT_MS', 15_000, { min: 0 }),

  /** How often to refresh Discord typing indicators while work is in flight (ms) */
  discordTypingRefreshMs: envInt('DISCORD_TYPING_REFRESH_MS', 4_000, { min: 1_000 }),

  /** How long a routed Discord input keeps typing alive without a routed output (ms) */
  discordTypingLeaseMs: envInt('DISCORD_TYPING_LEASE_MS', 120_000, { min: 1_000 }),

  /** Log level */
  logLevel: parseEnumSetting(
    CONFIG_SOURCE,
    'LOG_LEVEL',
    'info',
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const,
  ),

  /** Working directory for pi agent */
  piCwd: env('PI_CWD', DEFAULT_PROJECT_ROOT),

  /** CLAWAS control socket root */
  clawasControlSocketRoot: env('PI_CLAWAS_CONTROL_SOCKET_ROOT', resolve(env('PI_CWD', DEFAULT_PROJECT_ROOT), '.pi')),

  /** CLAWAS control socket dir under the socket root */
  clawasControlSocketDir: env('PI_CLAWAS_CONTROL_SOCKET_DIR', 'clawas-control'),

  /** Auto-register DM channels */
  autoRegisterDMs: envBool('AUTO_REGISTER_DMS', true),

  /** Request the privileged Guild Members intent */
  guildMembersIntent: envBool('ENABLE_GUILD_MEMBERS_INTENT', false),

  /** Request the privileged Guild Presences intent */
  guildPresencesIntent: envBool('ENABLE_GUILD_PRESENCES_INTENT', false),

  /** Inject guild presence context into prompts for guild channels */
  includeGuildPresenceContext: envBool('INCLUDE_GUILD_PRESENCE_CONTEXT', false),

  /** Maximum recent Discord messages to include when catching Clawa up (0 = all unseen) */
  recentContextMessages: envInt('RECENT_CONTEXT_MESSAGES', 8, { min: 0 }),

  /** Channel access policy: open, open-trigger, or allowlist */
  channelPolicy: parseChannelPolicy(env('CHANNEL_POLICY', DEFAULT_CHANNEL_POLICY)),

  /** Comma-separated channel IDs to exclude from auto-registration */
  excludedChannels: new Set(
    env('EXCLUDED_CHANNELS').split(',').map((s) => s.trim()).filter(Boolean),
  ),

  /** Max size for a single Discord attachment in bytes (0 disables the limit) */
  maxAttachmentBytes: envInt('MAX_ATTACHMENT_BYTES', 10 * 1024 * 1024, { min: 0 }),

  /** Max combined attachment size per Discord message in bytes (0 disables the limit) */
  maxTotalAttachmentBytes: envInt('MAX_TOTAL_ATTACHMENT_BYTES', 25 * 1024 * 1024, { min: 0 }),
} as const;

export type Config = typeof config;
