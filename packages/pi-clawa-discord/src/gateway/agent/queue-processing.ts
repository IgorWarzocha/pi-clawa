import { getChannel, markChannelContextSeen, markMessageDone, markMessageFailed } from '../db.js';
import { sendResponse } from '../discord/client.js';
import { logger } from '../logger.js';
import { resolveClawaWorkerForDiscordChannel } from '../channel-routes.js';
import { buildGatewayPrompt, getReplyAnchorSourceMessageId } from './gateway-prompt.js';
import { buildClawasDiscordContext } from './invoke-clawas.js';
import { sendClawasSessionMessage } from './invoke-clawas-rpc.js';
import { ensureWorkerOutputMonitor } from './worker-output-monitor.js';

export async function processQueuedMessage(params: {
  jid: string;
  rowid: number;
  sender: string;
  senderName: string;
  sourceMessageId: string | null;
  content: string;
  signal: AbortSignal;
  attachments?: string | null;
  logRowId?: number | null;
}): Promise<void> {
  const { jid, rowid, sender, senderName, sourceMessageId, content, signal, logRowId } = params;
  const channel = getChannel(jid);
  if (!channel) {
    logger.warn({ jid }, 'Channel disappeared during processing');
    markMessageFailed(rowid);
    return;
  }

  logger.info({ jid, senderName, len: content.length }, 'Delivering Discord message to Clawa');

  try {
    const mappedWorker = resolveClawaWorkerForDiscordChannel(jid);
    const { prompt, observedThroughRowId, messageHandles } = buildGatewayPrompt({
      jid,
      sender,
      senderName,
      content,
      mappedWorker,
      logRowId,
      sourceMessageId,
    });

    if (!mappedWorker) {
      markMessageFailed(rowid);
      await sendResponse(jid, 'This Discord channel is known, but it is not routed to a Clawa yet.');
      logger.warn({ jid, rowid }, 'Discord message had no Clawa route');
      return;
    }

    ensureWorkerOutputMonitor(mappedWorker);
    await sendClawasSessionMessage(mappedWorker, {
      message: prompt,
      mode: 'steer',
      messageType: 'session',
      discordContext: buildClawasDiscordContext({
        sourceMessageId: getReplyAnchorSourceMessageId(sender, sourceMessageId),
        sourceChannelJid: jid,
        messageHandles,
      }),
      sender: {
        workerId: 'discord-gateway',
        workerTitle: 'Discord',
      },
    });

    if (signal.aborted) {
      markMessageFailed(rowid);
      logger.info({ jid, rowid }, 'Message abandoned: shutdown interrupted delivery');
      return;
    }

    markChannelContextSeen(jid, observedThroughRowId);
    markMessageDone(rowid);
    logger.info({ jid, rowid, worker: mappedWorker }, 'Delivered Discord message to Clawa');
  } catch (err: any) {
    if (signal.aborted) {
      markMessageFailed(rowid);
      logger.info({ jid, rowid }, 'Message abandoned: shutdown interrupted delivery');
      return;
    }

    logger.error({ jid, err: err.message }, 'Discord message delivery to Clawa failed');
    markMessageFailed(rowid);
    try {
      await sendResponse(jid, `⚠️ Internal error: ${err.message?.slice(0, 200)}`);
    } catch {
      // Nothing else to do here.
    }
  }
}
