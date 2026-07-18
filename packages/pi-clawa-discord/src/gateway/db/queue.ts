import type { QueuedMessage } from "../types.js";
import { getDb } from "./connection.js";
import type Database from "better-sqlite3";

interface PendingChannelRow {
	channel_jid: string;
}

export function enqueueMessage(msg: {
	channelJid: string;
	sender: string;
	senderName: string;
	sourceMessageId?: string | null;
	replyToMessageId?: string | null;
	replyContext?: string | null;
	logRowId?: number | null;
	content: string;
	timestamp: string;
	attachments?: string | null;
}): boolean {
	const result = getDb().prepare(`
    insert or ignore into message_queue (channel_jid, sender, sender_name, source_message_id, reply_to_message_id, reply_context, log_rowid, content, timestamp, attachments)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		msg.channelJid,
		msg.sender,
		msg.senderName,
		msg.sourceMessageId ?? null,
		msg.replyToMessageId ?? msg.sourceMessageId ?? null,
		msg.replyContext ?? null,
		msg.logRowId ?? null,
		msg.content,
		msg.timestamp,
		msg.attachments ?? null,
	);
	return result.changes > 0;
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
    returning rowid, channel_jid, sender, sender_name, source_message_id, reply_to_message_id, reply_context, log_rowid, content, timestamp, status, attachments
  `)
		.get(channelJid) as QueuedMessage | undefined;
}

export function markMessageDone(rowid: number): void {
	markMessageDoneInDb(getDb(), rowid);
}

export function markMessageFailed(rowid: number): void {
	markMessageFailedInDb(getDb(), rowid);
}

export function markMessageAwaiting(rowid: number): boolean {
	return markMessageAwaitingInDb(getDb(), rowid);
}

export function markMessageAwaitingInDb(db: Database.Database, rowid: number): boolean {
	return db
		.prepare("update message_queue set status = 'awaiting' where rowid = ? and status = 'processing'")
		.run(rowid).changes > 0;
}

export function markMessageDoneInDb(db: Database.Database, rowid: number): void {
	db.prepare(
		"update message_queue set status = 'done', processed_at = datetime('now') where rowid = ?",
	).run(rowid);
}

export function markMessageFailedInDb(db: Database.Database, rowid: number): void {
	db.prepare(
		"update message_queue set status = 'failed', processed_at = datetime('now') where rowid = ?",
	).run(rowid);
}

export function clearPendingMessages(channelJid: string): number {
	const result = getDb()
		.prepare(
			"delete from message_queue where channel_jid = ? and status = 'pending'",
		)
		.run(channelJid);
	return result.changes;
}

export function updatePendingDiscordMessage(
	channelJid: string,
	sourceMessageId: string,
	content: string,
): boolean {
	return (
		getDb()
			.prepare(`
      update message_queue
      set content = ?
      where channel_jid = ? and source_message_id = ? and status = 'pending'
    `)
			.run(content, channelJid, sourceMessageId).changes > 0
	);
}

export function deletePendingDiscordMessage(
	channelJid: string,
	sourceMessageId: string,
): boolean {
	return (
		getDb()
			.prepare(`
      delete from message_queue
      where channel_jid = ? and source_message_id = ? and status = 'pending'
    `)
			.run(channelJid, sourceMessageId).changes > 0
	);
}

export function recoverStuckMessages(): number {
	return recoverStuckMessagesInDb(getDb());
}

export function recoverStuckMessagesInDb(db: Database.Database): number {
	const result = db
		.prepare("update message_queue set status = 'pending' where status = 'processing'")
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
