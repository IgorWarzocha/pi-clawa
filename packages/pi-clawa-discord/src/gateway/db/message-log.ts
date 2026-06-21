import type { LoggedMessage } from "../types.js";
import { getDb, normalizeTimestamp } from "./connection.js";

interface NumericRow {
	rowid?: number;
	count?: number;
}

export function logMessage(message: {
	channelJid: string;
	role: "user" | "assistant" | "reaction";
	senderId: string;
	senderName: string;
	sourceMessageId?: string | null;
	content: string;
	timestamp: string;
}): number {
	const result = getDb()
		.prepare(`
    insert into message_log (channel_jid, role, sender_id, sender_name, source_message_id, content, timestamp)
    values (?, ?, ?, ?, ?, ?, ?)
  `)
		.run(
			message.channelJid,
			message.role,
			message.senderId,
			message.senderName,
			message.sourceMessageId ?? null,
			message.content,
			normalizeTimestamp(message.timestamp) ?? message.timestamp,
		);

	return Number(result.lastInsertRowid);
}

export function getLatestLoggedMessageRowId(channelJid: string): number {
	const row = getDb()
		.prepare(`
    select coalesce(max(rowid), 0) as rowid
    from message_log
    where channel_jid = ?
      and role = 'user'
  `)
		.get(channelJid) as NumericRow | undefined;
	return row?.rowid ?? 0;
}

export function countLoggedMessagesSince(
	channelJid: string,
	afterRowId: number,
	throughRowId: number,
): number {
	const row = getDb()
		.prepare(`
    select count(*) as count
    from message_log
    where channel_jid = ?
      and role = 'user'
      and rowid > ?
      and rowid <= ?
  `)
		.get(channelJid, afterRowId, throughRowId) as NumericRow | undefined;
	return row?.count ?? 0;
}

export function listLoggedMessagesSince(
	channelJid: string,
	afterRowId: number,
	throughRowId: number,
	limit: number,
): LoggedMessage[] {
	const rows =
		limit > 0
			? (getDb()
					.prepare(`
      select rowid, channel_jid, role, sender_id, sender_name, source_message_id, content, timestamp
      from message_log
      where channel_jid = ?
        and role = 'user'
        and rowid > ?
        and rowid <= ?
      order by rowid desc
      limit ?
    `)
					.all(channelJid, afterRowId, throughRowId, limit) as LoggedMessage[])
			: (getDb()
					.prepare(`
      select rowid, channel_jid, role, sender_id, sender_name, source_message_id, content, timestamp
      from message_log
      where channel_jid = ?
        and role = 'user'
        and rowid > ?
        and rowid <= ?
      order by rowid asc
    `)
					.all(channelJid, afterRowId, throughRowId) as LoggedMessage[]);

	return limit > 0 ? rows.reverse() : rows;
}
