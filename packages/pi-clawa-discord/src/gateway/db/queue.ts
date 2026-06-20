import type { QueuedMessage } from "../types.js";
import { getDb } from "./connection.js";

interface PendingChannelRow {
	channel_jid: string;
}

export function enqueueMessage(msg: {
	channelJid: string;
	sender: string;
	senderName: string;
	sourceMessageId?: string | null;
	logRowId?: number | null;
	content: string;
	timestamp: string;
	attachments?: string | null;
}): void {
	getDb().prepare(`
    insert into message_queue (channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, attachments)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		msg.channelJid,
		msg.sender,
		msg.senderName,
		msg.sourceMessageId ?? null,
		msg.logRowId ?? null,
		msg.content,
		msg.timestamp,
		msg.attachments ?? null,
	);
}

export function claimNextMessage(
	channelJid: string,
): QueuedMessage | undefined {
	return getDb()
		.prepare(`
    with next_message as (
      select rowid
      from message_queue
      where status = 'pending' and channel_jid = ?
      order by rowid asc
      limit 1
    )
    update message_queue
    set status = 'processing'
    where rowid = (select rowid from next_message)
      and status = 'pending'
    returning rowid, channel_jid, sender, sender_name, source_message_id, log_rowid, content, timestamp, status, attachments
  `)
		.get(channelJid) as QueuedMessage | undefined;
}

export function markMessageDone(rowid: number): void {
	getDb()
		.prepare(
			"update message_queue set status = 'done', processed_at = datetime('now') where rowid = ?",
		)
		.run(rowid);
}

export function markMessageFailed(rowid: number): void {
	getDb()
		.prepare(
			"update message_queue set status = 'failed', processed_at = datetime('now') where rowid = ?",
		)
		.run(rowid);
}

export function clearPendingMessages(channelJid: string): number {
	const result = getDb()
		.prepare(
			"delete from message_queue where channel_jid = ? and status = 'pending'",
		)
		.run(channelJid);
	return result.changes;
}

export function recoverStuckMessages(): number {
	const result = getDb()
		.prepare(
			"update message_queue set status = 'pending' where status = 'processing'",
		)
		.run();
	return result.changes;
}

export function channelsWithPending(): string[] {
	const rows = getDb()
		.prepare(`
    select channel_jid
    from message_queue
    where status = 'pending'
    group by channel_jid
    order by min(rowid) asc
  `)
		.all() as PendingChannelRow[];
	return rows.map((row) => row.channel_jid);
}
