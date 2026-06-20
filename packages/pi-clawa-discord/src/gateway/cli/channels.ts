import type { RegisteredChannel } from '../types.js';
import { config } from '../config.js';
import { toDiscordChannelJid } from './channel-id.js';
import { withDb } from './db-context.js';

export async function cliRegister(args: string[]): Promise<void> {
  if (args.length < 2) {
    throw new Error('Usage: pi-clawa-discord register <channel-id> <name> [--folder <name>] [--cwd <path>] [--no-trigger] [--main]');
  }

  const { validateSessionFolder } = await import('../session/path.js');
  const [channelId, name, ...optionArgs] = args;
  if (!(channelId && name)) {
    throw new Error('Usage: pi-clawa-discord register <channel-id> <name> [--folder <name>] [--cwd <path>] [--no-trigger] [--main]');
  }
  const options = parseRegisterOptions(channelId, optionArgs, validateSessionFolder);

  await withDb(({ getChannel, registerChannel }) => {
    const jid = toDiscordChannelJid(channelId);
    const existing = getChannel(jid);
    const channel: RegisteredChannel = {
      jid,
      name,
      folder: options.folder,
      requiresTrigger: options.requiresTrigger,
      isMain: options.isMain,
      modelOverride: existing?.modelOverride ?? '',
      thinkingOverride: existing?.thinkingOverride ?? '',
      cwdOverride: options.cwdOverride ?? existing?.cwdOverride ?? '',
    };

    registerChannel(channel);
    console.log(`Registered channel: ${name} (${channel.jid})`);
    console.log(`  Folder: ${channel.folder}`);
    console.log(
      `  Working directory: ${channel.cwdOverride || config.piCwd}${channel.cwdOverride ? ' (channel override)' : ' (gateway default)'}`,
    );
    console.log(`  Trigger required: ${channel.requiresTrigger}`);
    console.log(`  Main channel: ${channel.isMain}`);
  });
}

export async function cliUnregister(args: string[]): Promise<void> {
  if (args.length < 1) {
    throw new Error('Usage: pi-clawa-discord unregister <channel-id>');
  }

  await withDb(({ unregisterChannel }) => {
    const channelId = args[0];
    if (!channelId) {
      throw new Error('Usage: pi-clawa-discord unregister <channel-id>');
    }
    const jid = toDiscordChannelJid(channelId);
    const ok = unregisterChannel(jid);
    if (ok) {
      console.log(`Unregistered channel: ${jid}`);
    } else {
      console.log(`Channel not found: ${jid}`);
    }
  });
}

export async function cliListChannels(): Promise<void> {
  await withDb(({ getAllChannels }) => {
    const channels = getAllChannels();
    if (channels.length === 0) {
      console.log('No registered channels.');
      return;
    }

    console.log(`Registered channels (${channels.length}):\n`);
    for (const channel of channels) {
      console.log(formatChannelSummary(channel));
    }
  });
}

function parseRegisterOptions(
  channelId: string,
  args: string[],
  validateSessionFolder: (folder: string) => string,
): { folder: string; requiresTrigger: boolean; isMain: boolean; cwdOverride?: string } {
  const options: { folder: string; requiresTrigger: boolean; isMain: boolean; cwdOverride?: string } = {
    folder: validateSessionFolder(`ch_${channelId}`),
    requiresTrigger: true,
    isMain: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--folder':
        {
          const folder = args[i + 1];
          if (folder) {
            i += 1;
            options.folder = validateSessionFolder(folder);
          }
        }
        break;
      case '--cwd':
        {
          const next = args[i + 1];
          if (next) {
            i += 1;
            const cwdOverride = next.trim();
          if (cwdOverride) {
            options.cwdOverride = cwdOverride;
          }
        }
        }
        break;
      case '--no-trigger':
        options.requiresTrigger = false;
        break;
      case '--main':
        options.isMain = true;
        options.requiresTrigger = false;
        break;
    }
  }

  return options;
}

function formatChannelSummary(channel: RegisteredChannel): string {
  const flags = [
    channel.isMain ? 'main' : '',
    channel.requiresTrigger ? 'trigger' : 'all-messages',
  ].filter(Boolean).join(', ');
  const overrides = [
    `cwd=${channel.cwdOverride || config.piCwd}${channel.cwdOverride ? ' (channel)' : ''}`,
    channel.modelOverride ? `model=${channel.modelOverride}` : '',
    channel.thinkingOverride ? `thinking=${channel.thinkingOverride}` : '',
  ].filter(Boolean).join(' ');

  return `  ${channel.jid}  ${channel.name}  [${flags}]  folder=${channel.folder}${overrides ? ` ${overrides}` : ''}`;
}
