import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { acquireGatewayLock } from '../shared/gateway-lock.js';
import { startDiscordDeliveryQueue, stopDiscordDeliveryQueue } from './agent/delivery-queue.js';
import { startProcessingLoop, stopProcessingLoop } from './agent/queue.js';
import { clearAllTypingLeases } from './agent/typing.js';
import { ensureDiscordRoutesFile } from './channel-routes.js';
import { config } from './config.js';
import { closeDb, initDb, writeChannelsSnapshot } from './db.js';
import { cleanupOldDiscordMediaAssets } from './discord/attachments.js';
import { getBotTag, startDiscord, stopDiscord } from './discord/client.js';
import { logger } from './logger.js';

export class GatewayRuntime {
  private processingStarted = false;
  private deliveryQueueStarted = false;
  private shutdownPromise: Promise<void> | null = null;
  private releaseLock: (() => Promise<void>) | null = null;
  private stoppingForSignal = false;
  private resolveSignalWait!: () => void;
  private readonly signalWait = new Promise<void>((resolve) => {
    this.resolveSignalWait = resolve;
  });

  private readonly onSignal = (signal: NodeJS.Signals): void => {
	this.stoppingForSignal = true;
    void this.shutdown(`received ${signal}`).then(this.resolveSignalWait, this.resolveSignalWait);
  };

  async run(): Promise<void> {
    if (!config.discordToken) {
      throw new Error(
        'DISCORD_BOT_TOKEN is required. Set it in config.env, .env, or the environment.',
      );
    }

    const lockPath = join(dirname(config.dbPath), 'gateway.pid');
    await mkdir(dirname(lockPath), { recursive: true });
    const startedAt = new Date().toISOString();
    this.releaseLock = await acquireGatewayLock(lockPath, {
      pid: process.pid,
      projectRoot: config.piCwd,
      entryPath: process.argv[1] ?? '',
      startedAt,
    });
    process.once('SIGINT', this.onSignal);
    process.once('SIGTERM', this.onSignal);

    try {
      initDb();
      ensureDiscordRoutesFile();
      writeChannelsSnapshot();
      cleanupOldDiscordMediaAssets();
      logger.info('Starting pi-clawa-discord-gateway...');

      await startDiscord();
      if (this.shutdownPromise) {
        await this.shutdownPromise;
        return;
      }

      startProcessingLoop();
      this.processingStarted = true;
      startDiscordDeliveryQueue();
      this.deliveryQueueStarted = true;
      logger.info(
        {
          bot: getBotTag(),
          trigger: `@${config.triggerName}`,
          concurrency: config.maxConcurrency,
        },
        'Gateway running',
      );
      await this.signalWait;
    } catch (error) {
      await this.shutdown('startup failure');
      if (this.stoppingForSignal) return;
      throw error;
    }
  }

  shutdown(reason: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.performShutdown(reason);
    return this.shutdownPromise;
  }

  private async performShutdown(reason: string): Promise<void> {
    process.off('SIGINT', this.onSignal);
    process.off('SIGTERM', this.onSignal);
    logger.info({ reason }, 'Shutting down gateway');

    if (this.processingStarted) {
      await stopProcessingLoop({ timeoutMs: config.shutdownTimeoutMs });
      this.processingStarted = false;
    }
    if (this.deliveryQueueStarted) {
      await stopDiscordDeliveryQueue();
      this.deliveryQueueStarted = false;
    }

    clearAllTypingLeases();
    stopDiscord();
    closeDb();
    await this.releaseLock?.();
    this.releaseLock = null;
    logger.info('Gateway stopped');
  }
}
