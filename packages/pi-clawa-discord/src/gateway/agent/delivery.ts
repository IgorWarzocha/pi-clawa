import type { ClawasDiscordContext } from '@howaboua/pi-clawa/clawas/comms/types';
import { enqueueDiscordDelivery } from '../db.js';
import type { DiscordDeliveryRequest } from '../delivery-types.js';
import { logger } from '../logger.js';
import type { DiscordMessageHandle } from '../types.js';
import { extractDiscordDirectives } from './discord-directives.js';
import { parseFinalRoutes, resolveDiscordRouteTarget } from './final-routes.js';
import { sendClawasSessionMessage } from './invoke-clawas-rpc.js';
import { clearTypingLease } from './typing.js';

const DISCORD_MAX_LENGTH = 2_000;

export async function deliverClawaFinalText(options: {
  workerId: string;
  outputKey: string;
  text: string;
  discordContext?: ClawasDiscordContext | null | undefined;
}): Promise<void> {
  const routed = parseFinalRoutes(options.text);
  if (!routed.hasRoutes) {
    throw new Error('Final text has no Discord route tags');
  }

  const sourceJid = options.discordContext?.channelJid ?? null;
  const sourceMessageId = options.discordContext?.sourceMessageId ?? null;
  const messageHandles = discordContextHandles(options.discordContext);
  let queuedIntents = 0;

  for (const [blockIndex, block] of routed.blocks.entries()) {
    if (block.target.kind === 'main-clawa') {
      await sendClawasSessionMessage('main-claw', {
        message: block.text,
        messageType: 'session',
        discordContext: options.discordContext ?? undefined,
        sender: {
          workerId: options.workerId,
          workerTitle: options.workerId,
        },
      });
      continue;
    }

    const targetJid =
      block.target.kind === 'quiet'
        ? sourceJid ?? firstHandleJid(messageHandles) ?? 'dc:unknown'
        : resolveDiscordRouteTarget(block.target, {
            workerId: options.workerId,
            sourceJid,
          });
    if (!targetJid) {
      throw new Error(`Could not resolve Discord route ${formatRouteTarget(block.target)}`);
    }

    const parsed = extractDiscordDirectives(block.text);
    const handlesByLabel = new Map(
      messageHandles.map((handle) => [handle.label.toLowerCase(), handle]),
    );
    for (const [reactionIndex, reaction] of parsed.reactions.entries()) {
      const handle = handlesByLabel.get(reaction.handle.toLowerCase());
      if (!handle) throw new Error(`Unknown reaction handle: ${reaction.handle}`);
      queueIntent(
        {
          channelJid: targetJid,
          typingJid: sourceJid ?? targetJid,
          files: [],
          reaction: {
            channelJid: handle.channelJid,
            messageId: handle.messageId,
            emoji: reaction.emoji,
          },
        },
        `${options.outputKey}:route:${blockIndex}:reaction:${reactionIndex}`,
      );
      queuedIntents += 1;
    }

    for (const [chunkIndex, chunk] of splitDiscordMessage(parsed.text).entries()) {
      queueIntent(
        {
          channelJid: targetJid,
          typingJid: sourceJid ?? targetJid,
          text: chunk,
          replyToMessageId:
            chunkIndex === 0 && targetJid === sourceJid ? sourceMessageId ?? undefined : undefined,
          files: [],
        },
        `${options.outputKey}:route:${blockIndex}:text:${chunkIndex}`,
      );
      queuedIntents += 1;
    }
  }

  if (queuedIntents === 0) clearTypingLease(sourceJid);
  logger.info(
    { worker: options.workerId, routes: routed.blocks.length, intents: queuedIntents },
    'Queued routed Discord final message',
  );
}

function queueIntent(request: DiscordDeliveryRequest, deliveryKey: string): void {
  enqueueDiscordDelivery(request, { deliveryKey });
}

export function splitDiscordMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > DISCORD_MAX_LENGTH) {
    let splitAt = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH);
    if (splitAt <= 0) splitAt = DISCORD_MAX_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/u, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function discordContextHandles(
  context: ClawasDiscordContext | null | undefined,
): DiscordMessageHandle[] {
  return Object.entries(context?.messageHandles ?? {}).map(([label, value]) => ({
    label,
    channelJid: value.channelJid,
    messageId: value.messageId,
  }));
}

function firstHandleJid(handles: DiscordMessageHandle[]): string | undefined {
  return handles[0]?.channelJid;
}

function formatRouteTarget(target: { kind: string; label?: string }): string {
  return target.kind === 'channel' ? target.label ?? '#channel' : target.kind;
}
