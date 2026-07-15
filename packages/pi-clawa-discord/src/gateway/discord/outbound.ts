import type { Client, TextChannel } from 'discord.js';

export async function setTypingWithClient(client: Client | null, jid: string): Promise<void> {
  if (!client) return;
  try {
    const channelId = jid.replace(/^dc:/u, '');
    const channel = await client.channels.fetch(channelId);
    if (channel && 'sendTyping' in channel) {
      await (channel as TextChannel).sendTyping();
    }
  } catch {
    // Best-effort; the lease will try again until its terminal state or TTL.
  }
}
