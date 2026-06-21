import type { ClawasExtractedDelivery, ClawasExtractedMessage } from '@howaboua/pi-clawa/clawas/comms/types';
import type { AgentResult, DiscordMessageHandle } from '../types.js';
import { config } from '../config.js';
import {
  getClawasWorkerOutput,
  sendClawasSessionMessage,
  sleep,
} from './invoke-clawas-rpc.js';
import { parseFinalRoutes, resolveDiscordRouteTarget } from './final-routes.js';
import { logger } from '../logger.js';
import { listDiscordRouteTags } from '../channel-routes.js';
import { findInvalidReactionHandle } from './discord-directives.js';

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
    messageHandles?: DiscordMessageHandle[] | undefined;
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

    const resolved = await waitForRoutableWorkerOutput(workerId, baseline, sentAt, opts);

    if (resolved.message?.error) {
      return {
        ok: false,
        text: '',
        error: `CLAWAS worker ${workerId} failed: ${resolved.message.error}`,
      };
    }

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

async function waitForRoutableWorkerOutput(
  workerId: string,
  baseline: ClawasWorkerOutput,
  sentAt: number,
  opts?: {
    signal?: AbortSignal | undefined;
    sourceMessageId?: string | null | undefined;
    sourceChannelJid?: string | undefined;
    messageHandles?: DiscordMessageHandle[] | undefined;
  },
): Promise<ChangedClawasWorkerOutput> {
  const resolved = await waitForWorkerOutputChange(workerId, baseline, sentAt, opts?.signal);
  if (resolved.changed !== 'message') {
    return resolved;
  }

  if (resolved.message?.error) {
    return resolved;
  }

  const routeProblem = getFinalRouteProblem(workerId, resolved.message?.content ?? '', opts?.messageHandles ?? []);
  if (!routeProblem) {
    return resolved;
  }

  logger.warn(
    { workerId, problem: routeProblem },
    'CLAWAS worker produced invalid Discord final routing; asking for routed final output',
  );

  const correctionSentAt = Date.now();
  await sendClawasSessionMessage(workerId, {
    message: [
      '[Discord gateway routing correction]',
      `Your last Discord final message was not delivered: ${routeProblem}.`,
      'Reply again now using explicit final routing blocks only:',
      ...listDiscordRouteTags(workerId).map((tag) => `- ${tag}`),
      ...formatReactionHandles(opts?.messageHandles ?? []),
      'Do not explain this correction publicly.',
    ].join('\n'),
    mode: 'followUp',
    messageType: 'session',
    kind: 'instruction',
    intent: 'reply_requested',
    visibility: 'worker',
    discordContext: buildDiscordContext(opts),
    sender: {
      workerId: 'discord-gateway',
      workerTitle: 'Discord',
    },
  });

  const corrected = await waitForWorkerOutputChange(
    workerId,
    { message: resolved.message, delivery: resolved.delivery },
    correctionSentAt,
    opts?.signal,
  );

  if (
    corrected.changed === 'message'
    && getFinalRouteProblem(workerId, corrected.message?.content ?? '', opts?.messageHandles ?? [])
  ) {
    logger.warn(
      { workerId },
      'CLAWAS worker still produced invalid Discord final routing after correction',
    );
  }

  return corrected;
}

function getFinalRouteProblem(workerId: string, text: string, messageHandles: DiscordMessageHandle[]): string | null {
  const parsed = parseFinalRoutes(text);
  if (!parsed.hasRoutes) {
    return text.trim() ? 'it had no route tag' : 'it was empty';
  }

  for (const block of parsed.blocks) {
    const invalidReactionHandle = findInvalidReactionHandle(
      block.text,
      new Set(messageHandles.map((handle) => handle.label.toLowerCase())),
    );
    if (invalidReactionHandle) {
      return `${invalidReactionHandle} is not a known message handle`;
    }

    if (block.target.kind === 'quiet' || block.target.kind === 'main-clawa') {
      continue;
    }
    if (!resolveDiscordRouteTarget(block.target, workerId)) {
      const target = block.target.kind === 'dm' ? '[dm]' : `[${block.target.label}]`;
      return `${target} is not a known route`;
    }
  }

  return null;
}

function formatReactionHandles(messageHandles: DiscordMessageHandle[]): string[] {
  if (messageHandles.length === 0) {
    return ['No reaction handles are available for this turn.'];
  }

  return [
    'Reaction handles available this turn:',
    ...messageHandles.map((handle) => `- ${handle.label}`),
    'Use reactions as [react m1: emoji]; do not use bare [React: emoji].',
  ];
}

function buildDiscordContext(
  opts?: {
    sourceMessageId?: string | null | undefined;
    sourceChannelJid?: string | undefined;
    messageHandles?: DiscordMessageHandle[] | undefined;
  },
): {
  sourceMessageId?: string | undefined;
  channelJid?: string | undefined;
  messageHandles?: Record<string, { channelJid: string; messageId: string }> | undefined;
} | undefined {
  const sourceMessageId = opts?.sourceMessageId?.trim() || undefined;
  const channelJid = opts?.sourceChannelJid?.trim() || undefined;
  const messageHandles = buildMessageHandleMap(opts?.messageHandles ?? []);
  if (!(sourceMessageId || channelJid || messageHandles)) {
    return undefined;
  }

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
    ) {
      if (!messageCandidate || !sameMessage(next.message, messageCandidate.message)) {
        messageCandidate = { ...next, changed: 'message' };
        messageCandidateReadyAt = Date.now() + CLAWAS_MESSAGE_SETTLE_MS;
        logger.info(
          { workerId, settleMs: CLAWAS_MESSAGE_SETTLE_MS },
          'Observed CLAWAS assistant message; waiting briefly for tool delivery/finalization',
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
      && !sameDelivery(next, baseline),
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
