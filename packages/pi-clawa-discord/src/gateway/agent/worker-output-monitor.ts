import { createHash } from 'node:crypto';
import type {
  ClawasDiscordContext,
  ClawasExtractedMessage,
} from '@howaboua/pi-clawa/clawas/comms/types';
import { listDiscordRouteTags, listDiscordRouteWorkers } from '../channel-routes.js';
import { hasProcessedWorkerOutput, markWorkerOutputProcessed } from '../db.js';
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
  initialized: boolean;
  isProcessing: boolean;
  failures: number;
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
    initialized: false,
    isProcessing: false,
    failures: 0,
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
  if (!running) return;
  if (state.isProcessing) {
    schedule(workerId, state);
    return;
  }
  state.isProcessing = true;
  let nextDelay = POLL_MS;
  try {
    const output = await getClawasWorkerOutput(workerId);
    if (!state.initialized) {
      state.initialized = true;
    }

    if (isNewMessage(output.message, state.lastMessage)) {
      await processAssistantMessage(workerId, output.message, output.discordContext);
      state.lastMessage = output.message;
    }
    state.failures = 0;
  } catch (err: any) {
    state.failures += 1;
    nextDelay = Math.min(30_000, POLL_MS * 2 ** Math.min(state.failures, 6));
    logger.warn({ workerId, err: err.message }, 'Discord worker output monitor failed to process worker output');
  } finally {
    state.isProcessing = false;
    const latest = workers.get(workerId);
    if (latest) schedule(workerId, latest, nextDelay);
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
    clearTypingLease(context?.channelJid);
    markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
    return;
  }

  const text = message.content.trim();
  const problem = getFinalRouteProblem(
    workerId,
    text,
    discordContextHandles(context),
    context?.channelJid,
  );
  if (problem) {
    logger.warn({ workerId, problem }, 'Discord Clawa produced invalid final routing; asking for retry');
    await sendRoutingCorrection(workerId, problem, context);
    markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
    return;
  }

  await deliverClawaFinalText({
    workerId,
    outputKey: workerOutputDeliveryKey(workerId, message.timestamp, message.content),
    text,
    discordContext: context,
  });
  markWorkerOutputProcessed({ workerId, timestamp: message.timestamp, content: message.content });
}

function workerOutputDeliveryKey(workerId: string, timestamp: number, content: string): string {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `worker:${workerId}:${timestamp}:${hash}`;
}

function getFinalRouteProblem(
  workerId: string,
  text: string,
  messageHandles: DiscordMessageHandle[],
  sourceJid?: string,
): string | null {
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
    if (!resolveDiscordRouteTarget(block.target, { workerId, sourceJid })) {
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
