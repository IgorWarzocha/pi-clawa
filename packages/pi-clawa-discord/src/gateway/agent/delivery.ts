import type { ClawasDiscordContext } from '@howaboua/pi-clawa/clawas/comms/types';
import { addReaction, sendResponse } from '../discord/client.js';
import { isNothingForDiscord } from '../discord/send.js';
import { logMessage } from '../db.js';
import { logger } from '../logger.js';
import type { DiscordMessageHandle } from '../types.js';
import { extractDiscordDirectives } from './discord-directives.js';
import { parseFinalRoutes, resolveDiscordRouteTarget } from './final-routes.js';
import { sendClawasSessionMessage } from './invoke-clawas-rpc.js';
import { clearTypingLease } from './typing.js';

export async function deliverClawaFinalText(options: {
  workerId: string;
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
  const completedTypingJids = new Set<string>();
  if (sourceJid) completedTypingJids.add(sourceJid);

  for (const block of routed.blocks) {
    if (block.target.kind === 'quiet') {
      const quietJid = sourceJid ?? firstHandleJid(messageHandles) ?? 'dc:unknown';
      await deliverDiscordText(quietJid, block.text, {
        defaultReplyToMessageId: null,
        workerId: options.workerId,
        messageHandles,
      });
      completedTypingJids.add(quietJid);
      continue;
    }

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

    const targetJid = resolveDiscordRouteTarget(block.target, {
      workerId: options.workerId,
      sourceJid,
    });
    if (!targetJid) {
      throw new Error(`Could not resolve Discord route ${formatRouteTarget(block.target)}`);
    }

    const delivered = await deliverDiscordText(targetJid, block.text, {
      defaultReplyToMessageId: targetJid === sourceJid ? sourceMessageId : null,
      workerId: options.workerId,
      messageHandles,
    });
    if (!delivered) {
      throw new Error(`Could not send Discord route ${formatRouteTarget(block.target)}`);
    }
    completedTypingJids.add(targetJid);
  }

  for (const jid of completedTypingJids) clearTypingLease(jid);

  logger.info({ worker: options.workerId, routes: routed.blocks.length }, 'Delivered routed Discord final message');
}

async function deliverDiscordText(
  jid: string,
  text: string,
  options: {
    defaultReplyToMessageId: string | null;
    workerId: string;
    messageHandles: DiscordMessageHandle[];
  },
): Promise<boolean> {
  const parsed = extractDiscordDirectives(text);
  const handlesByLabel = new Map(
    options.messageHandles.map((handle) => [handle.label.toLowerCase(), handle]),
  );

  for (const reaction of parsed.reactions) {
    const handle = handlesByLabel.get(reaction.handle.toLowerCase());
    if (!handle) {
      throw new Error(`Unknown reaction handle: ${reaction.handle}`);
    }
    const reacted = await addReaction(handle.channelJid, handle.messageId, reaction.emoji);
    if (!reacted) {
      logger.warn(
        { jid: handle.channelJid, handle: reaction.handle, emoji: reaction.emoji },
        'Discord reaction could not be delivered; not retrying routed text',
      );
    }
  }

  if (isNothingForDiscord(parsed.text)) {
    logger.info(
      { jid, worker: options.workerId, reactions: parsed.reactions.length },
      'Suppressed [quiet] response text',
    );
    return true;
  }

  if (!parsed.text) {
    logger.info({ jid, worker: options.workerId }, 'Message handled with reaction only');
    return true;
  }

  const sent = await sendResponse(jid, parsed.text, {
    replyToMessageId: options.defaultReplyToMessageId,
  });
  if (!sent) {
    logger.warn({ jid }, 'Agent response generated but could not be delivered to Discord');
    return false;
  }

  logMessage({
    channelJid: jid,
    role: 'assistant',
    senderId: 'assistant',
    senderName: 'Clawa',
    content: parsed.text,
    timestamp: new Date().toISOString(),
  });
  logger.info(
    { jid, responseLen: parsed.text.length, reactions: parsed.reactions.length },
    'Message processed',
  );
  return true;
}

function discordContextHandles(context: ClawasDiscordContext | null | undefined): DiscordMessageHandle[] {
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
