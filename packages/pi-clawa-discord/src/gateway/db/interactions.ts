import type Database from "better-sqlite3";
import type { StoredDiscordInteraction } from "../types.js";
import { getDb, normalizeTimestamp } from "./connection.js";

export function storeDiscordInteraction(options: {
	token: string;
	channelJid: string;
	kind: StoredDiscordInteraction["kind"];
	payload: unknown;
	expiresAt: number;
}): void {
	getDb()
		.prepare(`
      insert into discord_interactions
        (token, channel_jid, kind, payload_json, expires_at)
      values (?, ?, ?, ?, ?)
    `)
		.run(
			options.token,
			options.channelJid,
			options.kind,
			JSON.stringify(options.payload),
			options.expiresAt,
		);
}

export function attachDiscordInteractionMessage(tokens: string[], messageId: string): void {
	if (tokens.length === 0) return;
	const update = getDb().prepare(
		"update discord_interactions set message_id = ? where token = ?",
	);
	getDb().transaction(() => {
		for (const token of tokens) update.run(messageId, token);
	})();
}

export function deleteDiscordInteractions(tokens: string[]): void {
	if (tokens.length === 0) return;
	const remove = getDb().prepare("delete from discord_interactions where token = ?");
	getDb().transaction(() => {
		for (const token of tokens) remove.run(token);
	})();
}

export function getDiscordInteraction(token: string): StoredDiscordInteraction | undefined {
	return getDb()
		.prepare(`
      select token, channel_jid, message_id, kind, payload_json, expires_at, consumed_at
      from discord_interactions
      where token = ?
    `)
		.get(token) as StoredDiscordInteraction | undefined;
}

export function enqueueDiscordInteractionTurn(options: {
	token?: string | undefined;
	channelJid: string;
	senderId: string;
	senderName: string;
	sourceMessageId: string;
	replyToMessageId?: string | undefined;
	content: string;
	timestamp: string;
	now?: number | undefined;
}): boolean {
	return enqueueDiscordInteractionTurnInDb(getDb(), options);
}

export function enqueueDiscordInteractionTurnInDb(
	db: Database.Database,
	options: {
		token?: string | undefined;
		channelJid: string;
		senderId: string;
		senderName: string;
		sourceMessageId: string;
		replyToMessageId?: string | undefined;
		content: string;
		timestamp: string;
		now?: number | undefined;
	},
): boolean {
	return db.transaction(() => {
		if (options.token) {
			const now = options.now ?? Date.now();
			const consumed = db
				.prepare(`
            update discord_interactions
            set consumed_at = ?
            where token = ? and consumed_at is null and expires_at > ?
          `)
				.run(now, options.token, now).changes;
			if (consumed === 0) return false;
		}

		const normalizedTimestamp = normalizeTimestamp(options.timestamp) ?? options.timestamp;
		const logInsert = db
			.prepare(`
        insert or ignore into message_log
          (channel_jid, role, sender_id, sender_name, source_message_id, content, timestamp)
        values (?, 'user', ?, ?, ?, ?, ?)
      `)
			.run(
				options.channelJid,
				options.senderId,
				options.senderName,
				options.sourceMessageId,
				options.content,
				normalizedTimestamp,
			);
		const logRowId =
			logInsert.changes > 0
				? Number(logInsert.lastInsertRowid)
				: (
						db
							.prepare(`
                select rowid from message_log
                where channel_jid = ? and role = 'user' and source_message_id = ?
              `)
							.get(options.channelJid, options.sourceMessageId) as { rowid: number }
					).rowid;

		db
			.prepare(`
        insert or ignore into message_queue
          (channel_jid, sender, sender_name, source_message_id, reply_to_message_id,
           log_rowid, content, timestamp)
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `)
			.run(
				options.channelJid,
				options.senderId,
				options.senderName,
				options.sourceMessageId,
				options.replyToMessageId ?? options.sourceMessageId,
				logRowId,
				options.content,
				normalizedTimestamp,
			);
		return true;
	})();
}

export function cleanupDiscordInteractions(now = Date.now()): number {
	return getDb()
		.prepare("delete from discord_interactions where expires_at <= ?")
		.run(now).changes;
}
