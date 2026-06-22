import type {
  ClawasDiscordContext,
  ClawasExtractedDelivery,
  ClawasExtractedMessage,
} from '@howaboua/pi-clawa/clawas/comms/types';
import { listDiscordRouteTags, listDiscordRouteWorkers } from '../channel-routes.js';
import { hasProcessedWorkerOutput, markWorkerOutputProcessed } from '../db.js';
import { sendResponse } from '../discord/client.js';
import { logger } from '../logger.js';
import type { DiscordMessageHandle } from '../types.js';
import { findInvalidReactionHandle } from './discord-directives.js';
import { deliverClawaFinalText } from './delivery.js';
import { parseFinalRoutes, resolveDiscordRouteTarget } from './final-routes.js';
import {
  getClawasWorkerOutput,
  sendClawasSessionMessage,
} from './invoke-clawas-rpc.js';
import { clearTypingLease } from './typing.js';

const POLL_MS = 500;

interface WorkerOutputState {
  timer?: NodeJS.Timeout | undefined;
  lastMessage: ClawasExtractedMessage | null;
  lastDelivery: ClawasExtractedDelivery | null;
  initialized: boolean;
  isProcessing: boolean;
}

const workers = new Map<string, WorkerOutputState>();
let running = false;

export function startWorkerOutputMonitors(): void {
  running = true;
  for (const workerId of listDiscordRouteWorkers()) {
    ensureWorkerOutputMonitor(workerId);
  }
}

export function stopWorkerOutputMonitors(): void {
  running = false;
  for (const state of workers.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  workers.clear();
}

export function ensureWorkerOutputMonitor(workerId: string): void {
  if (!running) return;
  if (workers.has(workerId)) return;
  const state: WorkerOutputState = {
    lastMessage: null,
    lastDelivery: null,
    initialized: false,
    isProcessing: false,
  };
  workers.set(workerId, state);
  schedule(workerId, state, 0);
}

export async function primeWorkerOutputMonitor(workerId: string): Promise<void> {
  ensureWorkerOutputMonitor(workerId);
  const state = workers.get(workerId);
  if (!state || state.isProcessing) return;

  state.isProcessing = true;
  try {
    const output = await getClawasWorkerOutput(workerId);
    state.lastDelivery = output.delivery;
    state.initialized = true;
    await processAssistantMessage(workerId, output.message, output.discordContext);
    state.lastMessage = output.message;
  } catch (err: any) {
    logger.debug({ workerId, err: err.message }, 'Could not prime Discord worker output monitor yet');
  } finally {
    state.isProcessing = false;
  }
}

function schedule(workerId: string, state: WorkerOutputState, delayMs = POLL_MS): void {
  if (!running) return;
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void pollWorker(workerId, state);
  }, delayMs);
  state.timer.unref?.();
}

async function pollWorker(workerId: string, state: WorkerOutputState): Promise<void> {
  if (!running || state.isProcessing) return;
  state.isProcessing = true;
  try {
    const output = await getClawasWorkerOutput(workerId);
    if (!state.initialized) {
      state.lastDelivery = output.delivery;
      state.initialized = true;
    }

    if (isNewDelivery(output.delivery, state.lastDelivery)) {
      state.lastDelivery = output.delivery;
    }

    if (isNewMessage(output.message, state.lastMessage)) {
      await processAssistantMessage(workerId, output.message, output.discordContext);
      state.lastMessage = output.message;
    }
  } catch (err: any) {
    logger.warn({ workerId, err: err.message }, 'Discord worker output monitor failed to process worker output');
  } finally {
    state.isProcessing = false;
    const latest = workers.get(workerId);
    if (latest) schedule(workerId, latest);
  }
}

async function processAssistantMessage(
  workerId: string,
  message: ClawasExtractedMessage | null,
  context: ClawasDiscordContext | null,
): Promise<void> {
  if (!message) return;
  if (hasProcessedWorkerOutput({ workerId, timestamp: message.timestamp, content: message.content })) {
    return;
  }

  if (message.error) {
    logger.warn({ workerId, err: message.error }, 'Discord Clawa assistant turn failed');
    await reportWorkerErrorToDiscord(workerId, message.error, context);
    markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
    return;
  }

  const text = message.content.trim();
  const problem = getFinalRouteProblem(workerId, text, discordContextHandles(context));
  if (problem) {
    logger.warn({ workerId, problem }, 'Discord Clawa produced invalid final routing; asking for retry');
    await sendRoutingCorrection(workerId, problem, context);
    markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
    return;
  }

  await deliverClawaFinalText({ workerId, text, discordContext: context });
  markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
}

async function reportWorkerErrorToDiscord(
  workerId: string,
  error: string,
  context: ClawasDiscordContext | null,
): Promise<void> {
  const jid = context?.channelJid;
  if (!jid) return;

  const message = formatWorkerError(error);
  try {
    await sendResponse(jid, message, {
      replyToMessageId: context.sourceMessageId ?? null,
    });
    clearTypingLease(jid);
  } catch (err: any) {
    logger.warn({ workerId, jid, err: err.message }, 'Could not report Discord Clawa worker error');
  }
}

function formatWorkerError(error: string): string {
  if (error.includes('model_context_window_exceeded')) {
    return 'I hit my context limit before I could answer. Igor needs to reload or rotate my Discord Clawa session.';
  }
  return 'I hit a model error before I could answer. Igor needs to check my Discord Clawa session.';
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
    if (invalidReactionHandle) return `${invalidReactionHandle} is not a known message handle`;

    if (block.target.kind === 'quiet' || block.target.kind === 'main-clawa') continue;
    if (!resolveDiscordRouteTarget(block.target, workerId)) {
      const target = block.target.kind === 'dm' ? '[dm]' : `[${block.target.label}]`;
      return `${target} is not a known route`;
    }
  }

  return null;
}

async function sendRoutingCorrection(
  workerId: string,
  problem: string,
  context: ClawasDiscordContext | null,
): Promise<void> {
  const handles = discordContextHandles(context);
  await sendClawasSessionMessage(workerId, {
    message: [
      '[Discord gateway routing correction]',
      `Your last Discord final message was not delivered: ${problem}.`,
      'Reply again now using explicit final routing blocks only:',
      ...listDiscordRouteTags(workerId).map((tag) => `- ${tag}`),
      ...formatReactionHandles(handles),
      'Do not explain this correction publicly.',
    ].join('\n'),
    mode: 'followUp',
    messageType: 'session',
    kind: 'instruction',
    intent: 'reply_requested',
    visibility: 'worker',
    discordContext: context ?? undefined,
    sender: {
      workerId: 'discord-gateway',
      workerTitle: 'Discord',
    },
  });
}

function formatReactionHandles(messageHandles: DiscordMessageHandle[]): string[] {
  if (messageHandles.length === 0) return ['No reaction handles are available for this turn.'];
  return [
    'Reaction handles available this turn:',
    ...messageHandles.map((handle) => `- ${handle.label}`),
    'Use reactions as [react m1: emoji]; do not use bare [React: emoji].',
  ];
}

function discordContextHandles(context: ClawasDiscordContext | null | undefined): DiscordMessageHandle[] {
  return Object.entries(context?.messageHandles ?? {}).map(([label, value]) => ({
    label,
    channelJid: value.channelJid,
    messageId: value.messageId,
  }));
}

function isNewMessage(
  next: ClawasExtractedMessage | null,
  previous: ClawasExtractedMessage | null,
): boolean {
  if (!next) return false;
  if (!previous) return true;
  return next.timestamp !== previous.timestamp || next.content !== previous.content;
}

function isNewDelivery(
  next: ClawasExtractedDelivery | null,
  previous: ClawasExtractedDelivery | null,
): boolean {
  if (!next) return false;
  if (!previous) return true;
  return next.timestamp !== previous.timestamp || next.route !== previous.route || next.content !== previous.content;
}
