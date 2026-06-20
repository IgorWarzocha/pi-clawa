import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const extensionDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const adapterEntryPath = join(extensionDir, 'index.ts')
export const DISCORD_WORKER_ID = 'discord-clawa'
export const DISCORD_WORKER_TITLE = 'Discord Clawa'
export const DISCORD_WORKER_CWD = 'clawas/discord-clawa'
export const DISCORD_CONFIG_RELATIVE = join('.pi', 'clawa-discord', 'config.env')
export const DISCORD_DATA_RELATIVE = join('.pi', 'clawa-discord')
export const GATEWAY_ENTRY = join(extensionDir, 'src', 'gateway', 'cli', 'index.ts')
export const SETUP_DOC_PATH = join(extensionDir, 'DISCORD-BOT-SETUP.md')
export const GATEWAY_SOURCE_DIR = join(extensionDir, 'src', 'gateway')

export const LINE_SPLIT_REGEX = /\r?\n/
export const TRAILING_NEWLINES_REGEX = /\n*$/
export const CHANNEL_PREFIX_REGEX = /^dc:/
export const INPUT_NEWLINE_REGEX = /[\r\n]/
export const STRIP_BLOCK_COMMENT_REGEX = /\/\*[\s\S]*?\*\//g
export const STRIP_LINE_COMMENT_REGEX = /^\s*\/\/.*$/gm
export const STRIP_TRAILING_COMMA_REGEX = /,\s*([}\]])/g
export const INPUT_CLEAN_NEWLINES_REGEX = /[\r\n]/g
export const TOKEN_VISIBLE_PREFIX = 6
export const TOKEN_VISIBLE_SUFFIX = 4
