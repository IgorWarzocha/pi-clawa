import type { StoredDiscordInteraction } from "../types.js";
import { getDb } from "./connection.js";

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

export function consumeDiscordInteraction(token: string, now = Date.now()): boolean {
	return (
		getDb()
			.prepare(`
        update discord_interactions
        set consumed_at = ?
        where token = ? and consumed_at is null and expires_at > ?
      `)
			.run(now, token, now).changes > 0
	);
}

export function cleanupDiscordInteractions(now = Date.now()): number {
	return getDb()
		.prepare("delete from discord_interactions where expires_at <= ?")
		.run(now).changes;
}
