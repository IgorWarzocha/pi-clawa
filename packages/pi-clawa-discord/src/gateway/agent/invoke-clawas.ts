import type { ClawasDiscordContext } from '@howaboua/pi-clawa/clawas/comms/types';
import type { DiscordMessageHandle } from '../types.js';

export function buildClawasDiscordContext(
  opts?: {
    sourceMessageId?: string | null | undefined;
    sourceChannelJid?: string | undefined;
    messageHandles?: DiscordMessageHandle[] | undefined;
  },
): ClawasDiscordContext | undefined {
  const sourceMessageId = opts?.sourceMessageId?.trim() || undefined;
  const channelJid = opts?.sourceChannelJid?.trim() || undefined;
  const messageHandles = buildMessageHandleMap(opts?.messageHandles ?? []);
  if (!(sourceMessageId || channelJid || messageHandles)) return undefined;
  return { sourceMessageId, channelJid, messageHandles };
}

function buildMessageHandleMap(
  handles: DiscordMessageHandle[],
): Record<string, { channelJid: string; messageId: string }> | undefined {
  if (handles.length === 0) return undefined;
  return Object.fromEntries(
    handles.map((handle) => [
      handle.label.toLowerCase(),
      { channelJid: handle.channelJid, messageId: handle.messageId },
    ]),
  );
}
