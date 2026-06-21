import { createHash } from 'node:crypto';
import { getDb } from './connection.js';

export function hasProcessedWorkerOutput(options: {
  workerId: string;
  timestamp: number;
  content: string;
}): boolean {
  const row = getDb()
    .prepare(`
      select 1
      from clawa_worker_outputs
      where worker_id = ?
        and message_timestamp = ?
        and content_hash = ?
      limit 1
    `)
    .get(options.workerId, options.timestamp, hashContent(options.content));
  return Boolean(row);
}

export function markWorkerOutputProcessed(options: {
  workerId: string;
  timestamp: number;
  content: string;
}): void {
  getDb()
    .prepare(`
      insert or ignore into clawa_worker_outputs (worker_id, message_timestamp, content_hash)
      values (?, ?, ?)
    `)
    .run(options.workerId, options.timestamp, hashContent(options.content));
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
