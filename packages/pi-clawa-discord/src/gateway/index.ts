import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';
import { initDb, closeDb, writeChannelsSnapshot } from './db.js';
import { startDiscord, stopDiscord, getBotTag } from './discord/client.js';
import { startProcessingLoop, stopProcessingLoop } from './agent/queue.js';
import { clearAllTypingLeases } from './agent/typing.js';
import { startDiscordDeliveryQueue, stopDiscordDeliveryQueue } from './agent/delivery-queue.js';
import { ensureDiscordRoutesFile } from './channel-routes.js';
import { cleanupOldDiscordMediaAssets } from './discord/attachments.js';

/**
 * pi-clawa-discord-gateway - Lightweight Discord gateway for pi coding agent.
 *
 * Architecture inspired by NanoClaw (https://github.com/qwibitai/nanoclaw).
 * Discord messages -> SQLite queue -> pi subprocess -> Discord response.
 */
export async function startGateway(): Promise<void> {
  if (!config.discordToken) {
    throw new Error('DISCORD_BOT_TOKEN is required. Set it in config.env, .env, or the environment.');
  }

  const releaseInstanceLock = await acquireGatewayInstanceLock();
  initDb();
  ensureDiscordRoutesFile();
  writeChannelsSnapshot();
  cleanupOldDiscordMediaAssets();

  let processingStarted = false;
  let deliveryQueueStarted = false;
  let shutdownPromise: Promise<void> | null = null;

  let resolveSignalWait!: () => void;
  const signalWait = new Promise<void>((resolve) => { resolveSignalWait = resolve; });

  const onSignal = (sig: NodeJS.Signals) => {
    void shutdown(`received ${sig}`).then(resolveSignalWait, resolveSignalWait);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const shutdown = (reason: string) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);

      logger.info({ reason }, 'Shutting down gateway');

      if (processingStarted) {
        await stopProcessingLoop({ timeoutMs: config.shutdownTimeoutMs });
      }

      if (deliveryQueueStarted) {
        await stopDiscordDeliveryQueue();
      }

      clearAllTypingLeases();
      stopDiscord();
      closeDb();
      await releaseInstanceLock();
      logger.info('Gateway stopped');
    })();

    return shutdownPromise;
  };

  try {
    logger.info('Starting pi-clawa-discord-gateway...');

    await startDiscord();
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    startProcessingLoop();
    processingStarted = true;
    startDiscordDeliveryQueue();
    deliveryQueueStarted = true;
    logger.info({
      bot: getBotTag(),
      trigger: `@${config.triggerName}`,
      concurrency: config.maxConcurrency,
    }, 'Gateway running');

    await signalWait;
  } catch (err) {
    await shutdown('startup failure');
    throw err;
  }
}

async function acquireGatewayInstanceLock(): Promise<() => Promise<void>> {
  const pidPath = join(dirname(config.dbPath), 'gateway.pid');
  await mkdir(dirname(pidPath), { recursive: true });

  const existingPid = await readGatewayPid(pidPath);
  if (existingPid && isProcessAlive(existingPid)) {
    throw new Error(`pi-clawa-discord gateway is already running as pid ${existingPid}`);
  }

  await writeFile(pidPath, `${process.pid}\n`, 'utf8');
  return async () => {
    const currentPid = await readGatewayPid(pidPath);
    if (currentPid === process.pid) {
      await rm(pidPath, { force: true });
    }
  };
}

async function readGatewayPid(pidPath: string): Promise<number | null> {
  try {
    const value = Number.parseInt((await readFile(pidPath, 'utf8')).trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
