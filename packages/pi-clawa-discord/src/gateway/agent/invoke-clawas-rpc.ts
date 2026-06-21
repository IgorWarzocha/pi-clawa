import { readlink } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import type {
  ClawasDiscordContext,
  ClawasExtractedDelivery,
  ClawasExtractedMessage,
  ClawasMessageIntent,
  ClawasMessageKind,
  ClawasMessageVisibility,
  ClawasRpcResponse,
  ClawasSenderInfo,
} from '@howaboua/pi-clawa/clawas/comms/types';
import { config } from '../config.js';

type ClawasWorkerOutput = {
  message: ClawasExtractedMessage | null;
  delivery: ClawasExtractedDelivery | null;
  discordContext: ClawasDiscordContext | null;
};

export interface ClawasWorkerStatus {
  isIdle: boolean;
  hasPendingMessages: boolean;
}

export async function getClawasWorkerOutput(target: string): Promise<ClawasWorkerOutput> {
  const response = await sendRpcCommand(target, { type: 'get_message' });
  if (!response.success) {
    throw new Error(response.error ?? `Failed to read CLAWAS message from ${target}`);
  }

  const data = response.data as {
    message?: ClawasExtractedMessage | null;
    delivery?: ClawasExtractedDelivery | null;
    discordContext?: ClawasDiscordContext | null;
  } | undefined;
  return {
    message: data?.message ?? null,
    delivery: data?.delivery ?? null,
    discordContext: data?.discordContext ?? null,
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

export async function sendClawasSessionMessage(
  target: string,
  options: {
    message: string;
    mode?: 'steer' | 'followUp' | undefined;
    messageType?: 'session' | 'report' | undefined;
    discordContext?: {
      sourceMessageId?: string | undefined;
      channelJid?: string | undefined;
      messageHandles?: Record<string, { channelJid: string; messageId: string }> | undefined;
    } | undefined;
    sender?: ClawasSenderInfo | undefined;
    kind?: ClawasMessageKind | undefined;
    intent?: ClawasMessageIntent | undefined;
    visibility?: ClawasMessageVisibility | undefined;
  },
): Promise<void> {
  const response = await sendRpcCommand(target, {
    type: 'send',
    message: options.message,
    mode: options.mode,
    messageType: options.messageType,
    discordContext: options.discordContext,
    sender: options.sender,
    kind: options.kind,
    intent: options.intent,
    visibility: options.visibility,
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

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
