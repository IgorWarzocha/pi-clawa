import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readlink } from 'node:fs/promises';
import type { AgentResult } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface HowabandaExtractedMessage {
  role: 'assistant';
  content: string;
  timestamp: number;
}

interface HowabandaExtractedDelivery {
  route: 'discord' | 'main-claw';
  content: string;
  timestamp: number;
}

type HowabandaWorkerOutput = {
  message: HowabandaExtractedMessage | null;
  delivery: HowabandaExtractedDelivery | null;
};

type ChangedHowabandaWorkerOutput = HowabandaWorkerOutput & {
  changed: 'message' | 'delivery';
};

const HOWABANDA_MESSAGE_SETTLE_MS = 2_500;

export interface HowabandaWorkerStatus {
  isIdle: boolean;
  hasPendingMessages: boolean;
}

interface HowabandaRpcResponse {
  type: 'response';
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface HowabandaSenderInfo {
  workerId?: string;
  workerTitle?: string;
}

export async function invokeHowabandaWorker(
  workerId: string,
  userText: string,
  opts?: { signal?: AbortSignal; attachments?: string | null; sourceMessageId?: string | null },
): Promise<AgentResult> {
  try {
    const baseline = await getHowabandaWorkerOutput(workerId);
    const sentAt = Date.now();
    await sendHowabandaSessionMessage(workerId, {
      message: userText,
      mode: 'steer',
      messageType: 'session',
      discordContext: opts?.sourceMessageId ? { sourceMessageId: opts.sourceMessageId } : undefined,
      sender: {
        workerId: 'discord-gateway',
        workerTitle: 'Discord',
      },
    });

    const resolved = await waitForWorkerOutputChange(workerId, baseline, sentAt, opts?.signal);

    if (resolved.changed === 'delivery') {
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
        error: `HOWABANDA worker ${workerId} returned an empty assistant message. The bridge is alive, but the model produced no text.`,
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

export async function steerHowabandaWorker(
  workerId: string,
  userText: string,
  opts?: { attachments?: string | null; sourceMessageId?: string | null },
): Promise<void> {
  await sendHowabandaSessionMessage(workerId, {
    message: userText,
    mode: 'steer',
    messageType: 'session',
    discordContext: opts?.sourceMessageId ? { sourceMessageId: opts.sourceMessageId } : undefined,
    sender: {
      workerId: 'discord-gateway',
      workerTitle: 'Discord',
    },
  });
}

async function waitForWorkerOutputChange(
  workerId: string,
  baseline: HowabandaWorkerOutput,
  sentAt: number,
  signal?: AbortSignal,
): Promise<ChangedHowabandaWorkerOutput> {
  const startedAt = Date.now();
  const timeoutMs = config.howabandaReplyTimeoutMs;
  const logIntervalMs = config.howabandaWaitLogIntervalMs;
  let nextLogAt = startedAt + logIntervalMs;
  let lastStatus: HowabandaWorkerStatus | null = null;
  let messageCandidate: ChangedHowabandaWorkerOutput | null = null;
  let messageCandidateReadyAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new Error('HOWABANDA invocation aborted during shutdown');
    }

    const next = await getHowabandaWorkerOutput(workerId);
    if (
      next.delivery
      && next.delivery.timestamp >= sentAt
      && !sameDelivery(next.delivery, baseline.delivery)
      && next.delivery.content.trim()
    ) {
      return { ...next, changed: 'delivery' };
    }

    if (
      next.message
      && next.message.timestamp >= sentAt
      && !sameMessage(next.message, baseline.message)
      && next.message.content.trim()
    ) {
      if (!messageCandidate || !sameMessage(next.message, messageCandidate.message)) {
        messageCandidate = { ...next, changed: 'message' };
        messageCandidateReadyAt = Date.now() + HOWABANDA_MESSAGE_SETTLE_MS;
        logger.info(
          { workerId, settleMs: HOWABANDA_MESSAGE_SETTLE_MS },
          'Observed HOWABANDA assistant text; waiting briefly for tool delivery/finalization',
        );
      } else if (Date.now() >= messageCandidateReadyAt) {
        return messageCandidate;
      }
    }

    const now = Date.now();
    if (now >= nextLogAt) {
      nextLogAt = now + logIntervalMs;
      try {
        lastStatus = await getHowabandaWorkerStatus(workerId);
      } catch (error: any) {
        logger.warn(
          { workerId, elapsedMs: now - startedAt, err: error?.message ?? String(error) },
          'Failed to read HOWABANDA worker status while waiting for reply',
        );
      }

      logger.info(
        {
          workerId,
          elapsedMs: now - startedAt,
          timeoutMs,
          isIdle: lastStatus?.isIdle,
          hasPendingMessages: lastStatus?.hasPendingMessages,
        },
        'Still waiting for HOWABANDA worker output',
      );
    }

    await sleep(250, signal);
  }

  throw new Error(
    `Timed out waiting for HOWABANDA worker ${workerId} to reply after ${timeoutMs}ms`
    + (lastStatus
      ? ` (isIdle=${String(lastStatus.isIdle)}, hasPendingMessages=${String(lastStatus.hasPendingMessages)})`
      : ''),
  );
}

function sameMessage(
  left: HowabandaExtractedMessage | null,
  right: HowabandaExtractedMessage | null,
): boolean {
  if (!left || !right) return false;
  return left.timestamp === right.timestamp && left.content === right.content;
}

function sameDelivery(
  left: HowabandaExtractedDelivery | null,
  right: HowabandaExtractedDelivery | null,
): boolean {
  if (!left || !right) return false;
  return left.timestamp === right.timestamp && left.route === right.route && left.content === right.content;
}

async function getHowabandaWorkerOutput(target: string): Promise<HowabandaWorkerOutput> {
  const response = await sendRpcCommand(target, { type: 'get_message' });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read HOWABANDA message from ${target}`);
  }

  const data = response.data as {
    message?: HowabandaExtractedMessage | null;
    delivery?: HowabandaExtractedDelivery | null;
  } | undefined;
  return {
    message: data?.message ?? null,
    delivery: data?.delivery ?? null,
  };
}

export async function getHowabandaWorkerStatus(target: string): Promise<HowabandaWorkerStatus> {
  const response = await sendRpcCommand(target, { type: 'get_status' });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read HOWABANDA worker status from ${target}`);
  }

  const data = response.data as Partial<HowabandaWorkerStatus> | undefined;
  return {
    isIdle: Boolean(data?.isIdle),
    hasPendingMessages: Boolean(data?.hasPendingMessages),
  };
}

async function sendHowabandaSessionMessage(
  target: string,
  options: {
    message: string;
    mode?: 'steer' | 'followUp';
    messageType?: 'session' | 'report';
    discordContext?: { sourceMessageId: string };
    sender?: HowabandaSenderInfo;
  },
): Promise<void> {
  const response = await sendRpcCommand(target, {
    type: 'send',
    message: options.message,
    mode: options.mode,
    messageType: options.messageType,
    discordContext: options.discordContext,
    sender: options.sender,
  });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to send HOWABANDA message to ${target}`);
  }
}

async function sendRpcCommand(target: string, command: Record<string, unknown>): Promise<HowabandaRpcResponse> {
  const socketPath = await waitForHowabandaSocketPath(target);
  if (!socketPath) {
    throw new Error(`Unknown HOWABANDA session target: ${target}. Keep the burrow session alive so the worker socket exists.`);
  }

  return await new Promise<HowabandaRpcResponse>((resolvePromise, reject) => {
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');

    const timeoutHandle = setTimeout(() => {
      socket.destroy(new Error('timeout'));
    }, 30_000);

    let buffer = '';
    const cleanup = () => {
      clearTimeout(timeoutHandle);
      socket.removeAllListeners();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(command)}\n`);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) continue;

        try {
          const response = JSON.parse(line) as HowabandaRpcResponse;
          if (response.type === 'response') {
            cleanup();
            socket.end();
            resolvePromise(response);
            return;
          }
        } catch {
          // Keep reading.
        }
      }
    });

    socket.on('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function waitForHowabandaSocketPath(target: string, timeoutMs = 3_000): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const socketPath = await resolveHowabandaSocketPath(target);
    if (socketPath) {
      return socketPath;
    }
    await sleep(100);
  }

  return await resolveHowabandaSocketPath(target);
}

async function resolveHowabandaSocketPath(target: string): Promise<string | null> {
  const controlDir = resolve(homedir(), '.pi', config.howabandaControlSocketDir);
  const aliasPath = resolve(controlDir, `${target}.alias`);

  try {
    const symlinkTarget = await readlink(aliasPath);
    return resolve(controlDir, symlinkTarget);
  } catch {
    return null;
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolvePromise();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('HOWABANDA invocation aborted during shutdown'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
