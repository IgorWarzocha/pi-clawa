import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { readlink } from 'node:fs/promises';
import type { AgentResult } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface ClawasExtractedMessage {
  role: 'assistant';
  content: string;
  timestamp: number;
}

interface ClawasExtractedDelivery {
  route: 'discord' | 'main-claw';
  content: string;
  timestamp: number;
}

type ClawasWorkerOutput = {
  message: ClawasExtractedMessage | null;
  delivery: ClawasExtractedDelivery | null;
};

type ChangedClawasWorkerOutput = ClawasWorkerOutput & {
  changed: 'message' | 'delivery';
};

const CLAWAS_MESSAGE_SETTLE_MS = 2_500;

export interface ClawasWorkerStatus {
  isIdle: boolean;
  hasPendingMessages: boolean;
}

interface ClawasRpcResponse {
  type: 'response';
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface ClawasSenderInfo {
  workerId?: string;
  workerTitle?: string;
}

export async function invokeClawasWorker(
  workerId: string,
  userText: string,
  opts?: { signal?: AbortSignal; attachments?: string | null; sourceMessageId?: string | null },
): Promise<AgentResult> {
  try {
    const baseline = await getClawasWorkerOutput(workerId);
    const sentAt = Date.now();
    await sendClawasSessionMessage(workerId, {
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
  opts?: { attachments?: string | null; sourceMessageId?: string | null },
): Promise<void> {
  await sendClawasSessionMessage(workerId, {
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
  baseline: ClawasWorkerOutput,
  sentAt: number,
  signal?: AbortSignal,
): Promise<ChangedClawasWorkerOutput> {
  const startedAt = Date.now();
  const timeoutMs = config.clawasReplyTimeoutMs;
  const logIntervalMs = config.clawasWaitLogIntervalMs;
  let nextLogAt = startedAt + logIntervalMs;
  let lastStatus: ClawasWorkerStatus | null = null;
  let messageCandidate: ChangedClawasWorkerOutput | null = null;
  let messageCandidateReadyAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new Error('CLAWAS invocation aborted during shutdown');
    }

    const next = await getClawasWorkerOutput(workerId);
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
        messageCandidateReadyAt = Date.now() + CLAWAS_MESSAGE_SETTLE_MS;
        logger.info(
          { workerId, settleMs: CLAWAS_MESSAGE_SETTLE_MS },
          'Observed CLAWAS assistant text; waiting briefly for tool delivery/finalization',
        );
      } else if (Date.now() >= messageCandidateReadyAt) {
        return messageCandidate;
      }
    }

    const now = Date.now();
    if (now >= nextLogAt) {
      nextLogAt = now + logIntervalMs;
      try {
        lastStatus = await getClawasWorkerStatus(workerId);
      } catch (error: any) {
        logger.warn(
          { workerId, elapsedMs: now - startedAt, err: error?.message ?? String(error) },
          'Failed to read CLAWAS worker status while waiting for reply',
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
        'Still waiting for CLAWAS worker output',
      );
    }

    await sleep(250, signal);
  }

  throw new Error(
    `Timed out waiting for CLAWAS worker ${workerId} to reply after ${timeoutMs}ms`
    + (lastStatus
      ? ` (isIdle=${String(lastStatus.isIdle)}, hasPendingMessages=${String(lastStatus.hasPendingMessages)})`
      : ''),
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

async function getClawasWorkerOutput(target: string): Promise<ClawasWorkerOutput> {
  const response = await sendRpcCommand(target, { type: 'get_message' });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read CLAWAS message from ${target}`);
  }

  const data = response.data as {
    message?: ClawasExtractedMessage | null;
    delivery?: ClawasExtractedDelivery | null;
  } | undefined;
  return {
    message: data?.message ?? null,
    delivery: data?.delivery ?? null,
  };
}

export async function getClawasWorkerStatus(target: string): Promise<ClawasWorkerStatus> {
  const response = await sendRpcCommand(target, { type: 'get_status' });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read CLAWAS worker status from ${target}`);
  }

  const data = response.data as Partial<ClawasWorkerStatus> | undefined;
  return {
    isIdle: Boolean(data?.isIdle),
    hasPendingMessages: Boolean(data?.hasPendingMessages),
  };
}

async function sendClawasSessionMessage(
  target: string,
  options: {
    message: string;
    mode?: 'steer' | 'followUp';
    messageType?: 'session' | 'report';
    discordContext?: { sourceMessageId: string };
    sender?: ClawasSenderInfo;
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
    throw new Error(response.error ?? `Failed to send CLAWAS message to ${target}`);
  }
}

async function sendRpcCommand(target: string, command: Record<string, unknown>): Promise<ClawasRpcResponse> {
  const socketPath = await waitForClawasSocketPath(target);
  if (!socketPath) {
    throw new Error(`Unknown CLAWAS session target: ${target}. Keep the clawa session alive so the worker socket exists.`);
  }

  return await new Promise<ClawasRpcResponse>((resolvePromise, reject) => {
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
          const response = JSON.parse(line) as ClawasRpcResponse;
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

async function waitForClawasSocketPath(target: string, timeoutMs = 3_000): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const socketPath = await resolveClawasSocketPath(target);
    if (socketPath) {
      return socketPath;
    }
    await sleep(100);
  }

  return await resolveClawasSocketPath(target);
}

async function resolveClawasSocketPath(target: string): Promise<string | null> {
  const controlDir = resolve(config.clawasControlSocketRoot, config.clawasControlSocketDir);
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
      reject(new Error('CLAWAS invocation aborted during shutdown'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
