import { config } from '../config.js';
import { setTyping } from '../discord/client.js';
import { logger } from '../logger.js';

interface TypingLease {
  jid: string;
  expiresAt: number;
  timer?: NodeJS.Timeout | undefined;
}

const activeTypingLeases = new Map<string, TypingLease>();

export function startTypingLease(jid: string, options: { ttlMs?: number; reason?: string } = {}): void {
  if (!jid || jid === 'dc:unknown') return;

  const ttlMs = options.ttlMs ?? config.discordTypingLeaseMs;
  const expiresAt = Date.now() + ttlMs;
  const existing = activeTypingLeases.get(jid);
  if (existing) {
    existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
    logger.debug({ jid, reason: options.reason, ttlMs }, 'Extended Discord typing lease');
    return;
  }

  const lease: TypingLease = { jid, expiresAt };
  activeTypingLeases.set(jid, lease);
  logger.debug({ jid, reason: options.reason, ttlMs }, 'Started Discord typing lease');
  void refreshTypingLease(jid);
}

export function clearTypingLease(jid: string | null | undefined): void {
  if (!jid) return;
  const lease = activeTypingLeases.get(jid);
  if (!lease) return;
  if (lease.timer) clearTimeout(lease.timer);
  activeTypingLeases.delete(jid);
  logger.debug({ jid }, 'Cleared Discord typing lease');
}

export function clearAllTypingLeases(): void {
  for (const lease of activeTypingLeases.values()) {
    if (lease.timer) clearTimeout(lease.timer);
  }
  activeTypingLeases.clear();
}

async function refreshTypingLease(jid: string): Promise<void> {
  const lease = activeTypingLeases.get(jid);
  if (!lease) return;
  if (Date.now() >= lease.expiresAt) {
    clearTypingLease(jid);
    return;
  }

  try {
    await setTyping(jid);
  } catch (err: any) {
    logger.warn({ jid, err: err.message }, 'Discord typing refresh failed');
  }

  const latest = activeTypingLeases.get(jid);
  if (!latest) return;
  latest.timer = setTimeout(() => {
    const current = activeTypingLeases.get(jid);
    if (current) current.timer = undefined;
    void refreshTypingLease(jid);
  }, config.discordTypingRefreshMs);
  latest.timer.unref?.();
}
