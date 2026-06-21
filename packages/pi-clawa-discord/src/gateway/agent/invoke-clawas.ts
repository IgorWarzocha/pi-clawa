import type { ClawasExtractedDelivery, ClawasExtractedMessage } from '@howaboua/pi-clawa/clawas/comms/types';
import type { AgentResult } from '../types.js';
import { config } from '../config.js';
import {
  getClawasWorkerOutput,
  sendClawasSessionMessage,
  sleep,
} from './invoke-clawas-rpc.js';
import { logger } from '../logger.js';

type ClawasWorkerOutput = {
  message: ClawasExtractedMessage | null;
  delivery: ClawasExtractedDelivery | null;
};

type ChangedClawasWorkerOutput = ClawasWorkerOutput & {
  changed: 'message' | 'discord-delivery' | 'private-delivery';
};

const CLAWAS_MESSAGE_SETTLE_MS = 2_500;

export interface ClawasWorkerStatus {
  isIdle: boolean;
  hasPendingMessages: boolean;
}

export async function invokeClawasWorker(
  workerId: string,
  userText: string,
  opts?: {
    signal?: AbortSignal | undefined;
    attachments?: string | null | undefined;
    sourceMessageId?: string | null | undefined;
    sourceChannelJid?: string | undefined;
  },
): Promise<AgentResult> {
  try {
    const baseline = await getClawasWorkerOutput(workerId);
    const sentAt = Date.now();
    await sendClawasSessionMessage(workerId, {
      message: userText,
      mode: 'steer',
      messageType: 'session',
      discordContext: buildDiscordContext(opts),
      sender: {
        workerId: 'discord-gateway',
        workerTitle: 'Discord',
      },
    });

    const resolved = await waitForWorkerOutputChange(workerId, baseline, sentAt, opts?.signal);

    if (resolved.changed === 'discord-delivery' || resolved.changed === 'private-delivery') {
      return { ok: true, text: '', route: 'handled' };
    }

    if (resolved.changed === 'message') {
      return {
        ok: true,
        text: resolved.message?.content ?? '',
        route: 'discord',
      };
    }

    const text = resolved.delivery?.route === 'discord'
      ? resolved.delivery.content
      : resolved.message?.content ?? '';

    if (!text.trim()) {
      return {
        ok: false,
        text: '',
        error: `CLAWAS worker ${workerId} returned an empty assistant message. The bridge is alive, but the model produced no text.`,
      };
    }
    return { ok: true, text: text || '(empty response)', route: 'discord' };
  } catch (err: any) {
    return {
      ok: false,
      text: '',
      error: err.message || String(err),
    };
  }
}

export async function steerClawasWorker(
  workerId: string,
  userText: string,
  opts?: {
    attachments?: string | null | undefined;
    sourceMessageId?: string | null | undefined;
    sourceChannelJid?: string | undefined;
  },
): Promise<void> {
  await sendClawasSessionMessage(workerId, {
    message: userText,
    mode: 'steer',
    messageType: 'session',
    discordContext: buildDiscordContext(opts),
    sender: {
      workerId: 'discord-gateway',
      workerTitle: 'Discord',
    },
  });
}

function buildDiscordContext(
  opts?: { sourceMessageId?: string | null | undefined; sourceChannelJid?: string | undefined },
): { sourceMessageId?: string | undefined; channelJid?: string | undefined } | undefined {
  const sourceMessageId = opts?.sourceMessageId?.trim() || undefined;
  const channelJid = opts?.sourceChannelJid?.trim() || undefined;
  if (!(sourceMessageId || channelJid)) {
    return undefined;
  }

  return { sourceMessageId, channelJid };
}

async function waitForWorkerOutputChange(
  workerId: string,
  baseline: ClawasWorkerOutput,
  sentAt: number,
  signal?: AbortSignal,
): Promise<ChangedClawasWorkerOutput> {
  const startedAt = Date.now();
  const timeoutMs = config.clawasReplyTimeoutMs;
  const logIntervalMs = config.clawasWaitLogIntervalMs;
  let nextLogAt = startedAt + logIntervalMs;
  let messageCandidate: ChangedClawasWorkerOutput | null = null;
  let messageCandidateReadyAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new Error('CLAWAS invocation aborted during shutdown');
    }

    const next = await getClawasWorkerOutput(workerId);
    if (isNewDelivery(next.delivery, baseline.delivery, sentAt)) {
      if (next.delivery?.route === 'discord') {
        return { ...next, changed: 'discord-delivery' };
      }

      logger.info(
        { workerId },
        'Observed CLAWAS private delivery; treating Discord event as handled asynchronously',
      );
      return { ...next, changed: 'private-delivery' };
    }

    if (
      next.message
      && next.message.timestamp >= sentAt
      && !sameMessage(next.message, baseline.message)
      && next.message.content.trim()
    ) {
      if (!messageCandidate || !sameMessage(next.message, messageCandidate.message)) {
        messageCandidate = { ...next, changed: 'message' };
        messageCandidateReadyAt = Date.now() + CLAWAS_MESSAGE_SETTLE_MS;
        logger.info(
          { workerId, settleMs: CLAWAS_MESSAGE_SETTLE_MS },
          'Observed CLAWAS assistant text; waiting briefly for tool delivery/finalization',
        );
      }
    }

    if (messageCandidate && Date.now() >= messageCandidateReadyAt) {
      return messageCandidate;
    }

    const now = Date.now();
    if (now >= nextLogAt) {
      nextLogAt = now + logIntervalMs;
      logger.info(
        {
          workerId,
          elapsedMs: now - startedAt,
          timeoutMs,
        },
        'Still waiting for CLAWAS worker output',
      );
    }

    await sleep(250, signal);
  }

  throw new Error(
    `Timed out waiting for CLAWAS worker ${workerId} to reply after ${timeoutMs}ms`
  );
}

function isNewDelivery(
  next: ClawasExtractedDelivery | null,
  baseline: ClawasExtractedDelivery | null,
  sentAt: number,
): boolean {
  return Boolean(
    next
      && next.timestamp >= sentAt
      && !sameDelivery(next, baseline)
      && next.content.trim(),
  );
}

function sameMessage(
  left: ClawasExtractedMessage | null,
  right: ClawasExtractedMessage | null,
): boolean {
  if (!left || !right) return false;
  return left.timestamp === right.timestamp && left.content === right.content;
}

function sameDelivery(
  left: ClawasExtractedDelivery | null,
  right: ClawasExtractedDelivery | null,
): boolean {
  if (!left || !right) return false;
  return left.timestamp === right.timestamp && left.route === right.route && left.content === right.content;
}


export { getClawasWorkerStatus } from './invoke-clawas-rpc.js';
