import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_PI_BIN = 'pi';
export const DEFAULT_CHANNEL_POLICY = 'allowlist' as const;

const DEFAULT_PROJECT_ROOT = process.env.PI_CWD?.trim() || process.cwd();
const DEFAULT_CONFIG_PATH = resolve(DEFAULT_PROJECT_ROOT, '.pi/claw-discord/config.env');
const DEFAULT_DATA_DIR = resolve(DEFAULT_PROJECT_ROOT, '.pi/claw-discord');
const LEGACY_ENV_PATH = resolve(process.cwd(), '.env');
const CONFIG_SOURCE = buildConfigSource();

export function resolveConfigPath(): string {
  const configuredPath = process.env.PIDG_CONFIG?.trim() ?? '';
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
    ...loadEnvFile(LEGACY_ENV_PATH),
    ...loadEnvFile(resolveConfigPath()),
    ...readProcessEnv(),
  };
}

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    return parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }
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

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function env(key: string, fallback = ''): string {
  return (readEnvValue(key) ?? '').trim() || fallback;
}

function envInt(key: string, fallback: number, opts: { min?: number } = {}): number {
  const raw = env(key);
  if (!raw) return fallback;

  const v = Number.parseInt(raw, 10);
  if (Number.isNaN(v)) return fallback;
  if (opts.min !== undefined && v < opts.min) return fallback;
  return v;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = env(key).toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function parseWorkerMap(value: string): Map<string, string> {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const equalsIndex = entry.indexOf('=');
      if (equalsIndex === -1) return null;
      const rawKey = entry.slice(0, equalsIndex).trim();
      const rawValue = entry.slice(equalsIndex + 1).trim();
      if (!rawKey || !rawValue) return null;
      const key = rawKey.startsWith('dc:') ? rawKey : `dc:${rawKey}`;
      return [key, rawValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  return new Map(entries);
}

const VALID_CHANNEL_POLICIES = ['open', 'open-trigger', 'allowlist'] as const;
type ChannelPolicy = typeof VALID_CHANNEL_POLICIES[number];

function parseChannelPolicy(value: string): ChannelPolicy {
  if ((VALID_CHANNEL_POLICIES as readonly string[]).includes(value)) {
    return value as ChannelPolicy;
  }
  return 'allowlist';
}

export const config = {
  /** Discord bot token (required) */
  discordToken: env('DISCORD_BOT_TOKEN'),

  /** Pi binary path */
  piBin: env('PI_BIN', DEFAULT_PI_BIN),

  /** Default model for pi */
  piModel: env('PI_MODEL'),

  /** Thinking level for pi */
  piThinking: env('PI_THINKING'),

  /** Base directory for per-channel session folders */
  sessionsDir: env('SESSIONS_DIR', resolve(DEFAULT_DATA_DIR, 'sessions')),

  /** Days to retain archived sessions (0 = never clean) */
  archiveRetentionDays: envInt('ARCHIVE_RETENTION_DAYS', 30, { min: 0 }),

  /** SQLite database path */
  dbPath: env('DB_PATH', resolve(DEFAULT_DATA_DIR, 'gateway.db')),

  /** Bot trigger name (default: bot's own display name) */
  triggerName: env('TRIGGER_NAME', 'pi'),

  /** Extra wake words that should trigger the bot when used as standalone words */
  triggerAliases: env('TRIGGER_ALIASES', 'claw,clawa').split(',').map((s) => s.trim()).filter(Boolean),

  /** Max concurrent agent invocations */
  maxConcurrency: envInt('MAX_CONCURRENCY', 3, { min: 1 }),

  /** Max scheduled tasks enqueued per scheduler tick */
  maxScheduledConcurrency: envInt('MAX_SCHEDULED_CONCURRENCY', 1, { min: 1 }),

  /** Whether the local scheduled-task loop should run */
  schedulerEnabled: envBool('ENABLE_SCHEDULER', false),

  /** Poll interval for message queue (ms) */
  pollInterval: envInt('POLL_INTERVAL_MS', 1000, { min: 1 }),

  /** Graceful shutdown timeout before aborting in-flight tasks (ms) */
  shutdownTimeoutMs: envInt('SHUTDOWN_TIMEOUT_MS', 15_000, { min: 0 }),

  /** How long to wait for a HOWABANDA worker to produce a reply/delivery (ms) */
  howabandaReplyTimeoutMs: envInt('HOWABANDA_REPLY_TIMEOUT_MS', 300_000, { min: 1_000 }),

  /** How often to log that we are still waiting on a HOWABANDA worker (ms) */
  howabandaWaitLogIntervalMs: envInt('HOWABANDA_WAIT_LOG_INTERVAL_MS', 15_000, { min: 1_000 }),

  /** How often to refresh Discord typing indicators while work is in flight (ms) */
  discordTypingRefreshMs: envInt('DISCORD_TYPING_REFRESH_MS', 4_000, { min: 1_000 }),

  /** Log level */
  logLevel: env('LOG_LEVEL', 'info'),

  /** Working directory for pi agent */
  piCwd: env('PI_CWD', DEFAULT_PROJECT_ROOT),

  /** Extra pi flags (space-separated) */
  piExtraFlags: env('PI_EXTRA_FLAGS'),

  /** HOWABANDA control socket root */
  howabandaControlSocketRoot: env('PI_HOWABANDA_CONTROL_SOCKET_ROOT', resolve(env('PI_CWD', DEFAULT_PROJECT_ROOT), '.pi')),

  /** HOWABANDA control socket dir under the socket root */
  howabandaControlSocketDir: env('PI_HOWABANDA_CONTROL_SOCKET_DIR', 'howabanda-control'),

  /** Optional Discord channel -> HOWABANDA worker mapping */
  howabandaChannelWorkers: parseWorkerMap(env('HOWABANDA_CHANNEL_WORKERS')),

  /** Auto-register DM channels */
  autoRegisterDMs: envBool('AUTO_REGISTER_DMS', true),

  /** Request the privileged Guild Members intent */
  guildMembersIntent: envBool('ENABLE_GUILD_MEMBERS_INTENT', false),

  /** Request the privileged Guild Presences intent */
  guildPresencesIntent: envBool('ENABLE_GUILD_PRESENCES_INTENT', false),

  /** Inject guild presence context into prompts for guild channels */
  includeGuildPresenceContext: envBool('INCLUDE_GUILD_PRESENCE_CONTEXT', false),

  /** Channel IDs where ambient jitter mode is allowed */
  ambientJitterChannels: new Set(
    env('AMBIENT_JITTER_CHANNELS').split(',').map((s) => s.trim()).filter(Boolean),
  ),

  /** Minimum human messages before an ambient jitter attempt */
  ambientJitterMinMessages: envInt('AMBIENT_JITTER_MIN_MESSAGES', 5, { min: 1 }),

  /** Maximum human messages before an ambient jitter attempt */
  ambientJitterMaxMessages: envInt('AMBIENT_JITTER_MAX_MESSAGES', 10, { min: 1 }),

  /** Minimum cooldown between ambient jitter attempts in seconds */
  ambientJitterCooldownSeconds: envInt('AMBIENT_JITTER_COOLDOWN_SECONDS', 600, { min: 0 }),

  /** Maximum observed human messages to include when catching pi up (0 = uncapped delta) */
  ambientContextMessages: envInt('AMBIENT_CONTEXT_MESSAGES', 0, { min: 0 }),

  /** Channel access policy: open, open-trigger, or allowlist */
  channelPolicy: parseChannelPolicy(env('CHANNEL_POLICY', DEFAULT_CHANNEL_POLICY)),

  /** Comma-separated channel IDs to exclude from auto-registration */
  excludedChannels: new Set(
    env('EXCLUDED_CHANNELS').split(',').map((s) => s.trim()).filter(Boolean),
  ),

  /** Max size for a single Discord attachment in bytes (0 disables the limit) */
  maxAttachmentBytes: envInt('MAX_ATTACHMENT_BYTES', 25 * 1024 * 1024, { min: 0 }),

  /** Max combined attachment size per Discord message in bytes (0 disables the limit) */
  maxTotalAttachmentBytes: envInt('MAX_TOTAL_ATTACHMENT_BYTES', 50 * 1024 * 1024, { min: 0 }),
} as const;

export type Config = typeof config;
