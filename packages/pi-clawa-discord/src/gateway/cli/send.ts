import { toDiscordChannelJid } from './channel-id.js';

export async function cliSend(args: string[]): Promise<void> {
  const usage = 'Usage: pi-clawa-discord send --channel <jid> [--text <message>] [--reply-to <message-id>] [--file <path> ...]';
  let channel: string | undefined;
  let text: string | undefined;
  let replyToMessageId: string | undefined;
  const files: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--channel':
        if (!args[i + 1]) {
          throw new Error(usage);
        }
        channel = args[++i];
        break;
      case '--file':
        if (!args[i + 1]) {
          throw new Error(usage);
        }
        i += 1;
        files.push(args[i] ?? '');
        break;
      case '--text':
        if (!args[i + 1]) {
          throw new Error(usage);
        }
        text = args[++i];
        break;
      case '--reply-to':
        if (!args[i + 1]) {
          throw new Error(usage);
        }
        replyToMessageId = args[++i];
        break;
      default:
        throw new Error(usage);
    }
  }

  if (!channel) {
    throw new Error(usage);
  }

  if (!text && files.length === 0) {
    throw new Error(`${usage}\nAt least one of --text or --file is required.`);
  }

  const { sendFilesToDiscord } = await import('../discord/send.js');
  const channelJid = toDiscordChannelJid(channel);
  const result = await sendFilesToDiscord({ channelJid, text, replyToMessageId, files });
  if (!result.sentText && result.sentFiles === 0) {
    console.log(`Skipped Discord send to ${channelJid}`);
    return;
  }

  if (result.sentFiles === 0) {
    console.log(`Sent message to ${channelJid}`);
    return;
  }

  console.log(`Sent ${result.sentFiles} file(s) to ${channelJid}`);
}
