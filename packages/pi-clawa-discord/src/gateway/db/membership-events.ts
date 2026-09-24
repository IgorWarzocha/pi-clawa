import type Database from "better-sqlite3";
import { getDb, normalizeTimestamp } from "./connection.js";

export interface DiscordMembershipEventInput {
	channelJid: string;
	eventId: string;
	content: string;
	timestamp: string;
}

export function enqueueDiscordMembershipEvent(
	event: DiscordMembershipEventInput,
): boolean {
	return enqueueDiscordMembershipEventInDb(getDb(), event);
}

export function enqueueDiscordMembershipEventInDb(
	db: Database.Database,
	event: DiscordMembershipEventInput,
): boolean {
	return db.transaction(() => {
		const timestamp = normalizeTimestamp(event.timestamp) ?? event.timestamp;
		const logInsert = db
			.prepare(`
        insert or ignore into message_log
          (channel_jid, role, sender_id, sender_name, source_message_id, content, timestamp)
        values (?, 'user', ?, ?, ?, ?, ?)
      `)
			.run(
				event.channelJid,
				"discord-gateway",
				"Discord",
				event.eventId,
				event.content,
				timestamp,
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
							.get(event.channelJid, event.eventId) as { rowid: number }
					).rowid;

		const queued = db
			.prepare(`
        insert or ignore into message_queue
          (channel_jid, sender, sender_name, source_message_id, reply_to_message_id,
           log_rowid, content, timestamp)
        values (?, 'discord-gateway', 'Discord', ?, null, ?, ?, ?)
      `)
			.run(
				event.channelJid,
				event.eventId,
				logRowId,
				event.content,
				timestamp,
			);

		return queued.changes > 0;
	})();
}
