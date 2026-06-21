import { PermissionFlagsBits, type GatewayIntentsString, type Guild, type Message } from 'discord.js';
import { config, type Config } from '../config.js';
import { logger } from '../logger.js';
import { sanitizeDiscordLabel } from './sanitize.js';

const ONLINE_STATUSES = new Set(['online', 'idle', 'dnd']);
const MAX_LISTED_MEMBERS = 12;
const MEMBER_FETCH_BATCH_SIZE = 100;

export interface PresenceSnapshotEntry {
  name: string;
  status: string;
}

export function buildGatewayIntents(currentConfig: Config = config): GatewayIntentsString[] {
  const intents: GatewayIntentsString[] = [
    'Guilds',
    'GuildMessages',
    'GuildMessageReactions',
    'MessageContent',
    'DirectMessages',
    'DirectMessageReactions',
  ];

  if (currentConfig.guildMembersIntent) {
    intents.push('GuildMembers');
  }

  if (currentConfig.guildPresencesIntent) {
    intents.push('GuildPresences');
  }

  return intents;
}

export function formatPresenceContext(entries: PresenceSnapshotEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const listed = sorted.slice(0, MAX_LISTED_MEMBERS)
    .map(({ name, status }) => `${name} (${status})`)
    .join(', ');
  const extraCount = Math.max(0, sorted.length - MAX_LISTED_MEMBERS);
  const extra = extraCount > 0 ? `, +${extraCount} more` : '';

  return `People visible in this Discord channel now: ${listed}${extra}. Presence is approximate.`;
}

export async function buildGuildPresenceContext(message: Message): Promise<string | null> {
  if (!config.includeGuildPresenceContext || !message.guild) return null;
  if (!('permissionsFor' in message.channel)) return null;

  try {
    const guild = message.guild;
    const onlinePresences = [...guild.presences.cache.values()]
      .filter((presence) => ONLINE_STATUSES.has(presence.status));

    if (onlinePresences.length === 0) {
      return null;
    }

    const onlineIds = [...new Set(onlinePresences.map((presence) => presence.userId))];
    await fetchMissingMembers(guild, onlineIds.filter((id) => !guild.members.cache.has(id)));

    const visibleMembers: PresenceSnapshotEntry[] = [];
    for (const presence of onlinePresences) {
      const member = guild.members.cache.get(presence.userId);
      if (!member || member.user.bot) continue;
      if (!message.channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel)) continue;

      visibleMembers.push({
        name: sanitizeDiscordLabel(member.displayName) || member.id,
        status: presence.status,
      });
    }

    return formatPresenceContext(visibleMembers) || null;
  } catch (err: any) {
    logger.warn({ err: err.message, channelId: message.channelId }, 'Failed to build guild presence context');
    return null;
  }
}

async function fetchMissingMembers(guild: Guild, missingIds: string[]): Promise<void> {
  for (let index = 0; index < missingIds.length; index += MEMBER_FETCH_BATCH_SIZE) {
    const batch = missingIds.slice(index, index + MEMBER_FETCH_BATCH_SIZE);
    if (batch.length === 0) continue;
    await guild.members.fetch({ user: batch });
  }
}
