import { getDb } from './connection.js';

interface ChannelContextRow {
  channel_jid: string;
  last_seen_log_rowid: number;
}

export function markChannelContextSeen(channelJid: string, logRowId: number): void {
  getDb()
    .prepare(`
    insert into channel_context_state (channel_jid, last_seen_log_rowid)
    values (?, ?)
    on conflict(channel_jid) do update set
      last_seen_log_rowid = max(channel_context_state.last_seen_log_rowid, excluded.last_seen_log_rowid)
  `)
    .run(channelJid, logRowId);
}

export function getChannelContextLastSeenLogRowId(channelJid: string): number {
  const row = getDb()
    .prepare('select channel_jid, last_seen_log_rowid from channel_context_state where channel_jid = ?')
    .get(channelJid) as ChannelContextRow | undefined;
  return row?.last_seen_log_rowid ?? 0;
}
