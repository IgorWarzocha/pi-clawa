export function toDiscordChannelJid(channelId: string): string {
  return channelId.startsWith('dc:') ? channelId : `dc:${channelId}`;
}
