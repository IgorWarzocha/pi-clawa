import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
	DiscordDeliveryQueueState,
	DiscordDeliveryRequest,
	DiscordDeliveryResult,
} from "../delivery-types.js";
import type { QueuedDiscordDelivery } from "../types.js";
import { getDb } from "./connection.js";

export function enqueueDiscordDelivery(
	request: DiscordDeliveryRequest,
	options: { deliveryKey?: string; maxAttempts?: number } = {},
): number {
	return enqueueDiscordDeliveryInDb(getDb(), request, options);
}

export function enqueueDiscordDeliveryInDb(
	db: Database.Database,
	request: DiscordDeliveryRequest,
	options: { deliveryKey?: string; maxAttempts?: number } = {},
): number {
	const deliveryKey = options.deliveryKey ?? `tool:${randomUUID()}`;
	const requestJson = JSON.stringify(request);
	db
		.prepare(`
      insert or ignore into discord_delivery_queue
        (delivery_key, nonce, request_json, max_attempts)
      values (?, ?, ?, ?)
    `)
		.run(
			deliveryKey,
			deliveryNonceForKey(deliveryKey),
			requestJson,
			options.maxAttempts ?? 5,
		);
	const row = db
		.prepare("select rowid, request_json from discord_delivery_queue where delivery_key = ?")
		.get(deliveryKey) as { rowid: number; request_json: string } | undefined;
	if (!row) throw new Error("Discord delivery could not be queued");
	if (row.request_json !== requestJson) {
		throw new Error(`Discord delivery key collision: ${deliveryKey}`);
	}
	return row.rowid;
}

export function claimNextDiscordDelivery(): QueuedDiscordDelivery | undefined {
	return claimNextDiscordDeliveryInDb(getDb());
}

export function claimNextDiscordDeliveryInDb(
	db: Database.Database,
	now = Date.now(),
): QueuedDiscordDelivery | undefined {
	return db
		.prepare(`
      with next_delivery as (
        select rowid
        from discord_delivery_queue
        where status = 'pending' and next_attempt_at <= ?
        order by rowid asc
        limit 1
      )
      update discord_delivery_queue
      set status = 'processing',
          attempt_count = attempt_count + 1,
          started_at = datetime('now')
      where rowid = (select rowid from next_delivery)
        and status = 'pending'
      returning rowid, request_json, status, nonce, attempt_count, max_attempts
    `)
		.get(now) as QueuedDiscordDelivery | undefined;
}

export function markDiscordDeliveryDone(rowid: number, result: DiscordDeliveryResult): void {
	markDiscordDeliveryDoneInDb(getDb(), rowid, result);
}

export function markDiscordDeliveryDoneInDb(
	db: Database.Database,
	rowid: number,
	result: DiscordDeliveryResult,
): void {
	db
		.prepare(`
      update discord_delivery_queue
      set status = 'done', result_json = ?, error = null,
          started_at = null, processed_at = datetime('now')
      where rowid = ?
    `)
		.run(JSON.stringify(result), rowid);
}

export function markDiscordDeliveryAttemptFailed(
	rowid: number,
	error: string,
	now = Date.now(),
): "pending" | "dead" {
	return markDiscordDeliveryAttemptFailedInDb(getDb(), rowid, error, now);
}

export function markDiscordDeliveryAttemptFailedInDb(
	db: Database.Database,
	rowid: number,
	error: string,
	now = Date.now(),
): "pending" | "dead" {
	const row = db
		.prepare("select attempt_count, max_attempts from discord_delivery_queue where rowid = ?")
		.get(rowid) as { attempt_count: number; max_attempts: number } | undefined;
	if (!row) throw new Error(`Discord delivery ${rowid} disappeared`);
	const terminal = row.attempt_count >= row.max_attempts;
	db
		.prepare(`
      update discord_delivery_queue
      set status = ?, error = ?, next_attempt_at = ?, started_at = null,
          processed_at = case when ? = 'dead' then datetime('now') else null end
      where rowid = ?
    `)
		.run(
			terminal ? "dead" : "pending",
			error,
			terminal ? 0 : now + discordDeliveryRetryDelayMs(row.attempt_count),
			terminal ? "dead" : "pending",
			rowid,
		);
	return terminal ? "dead" : "pending";
}

export function getDiscordDeliveryState(rowid: number): DiscordDeliveryQueueState | undefined {
	return getDiscordDeliveryStateInDb(getDb(), rowid);
}

export function getDiscordDeliveryStateInDb(
	db: Database.Database,
	rowid: number,
): DiscordDeliveryQueueState | undefined {
	const row = db
		.prepare("select status, attempt_count, result_json, error from discord_delivery_queue where rowid = ?")
		.get(rowid) as
		| {
				status: DiscordDeliveryQueueState["status"];
				attempt_count: number;
				result_json: string | null;
				error: string | null;
			}
		| undefined;
	if (!row) return undefined;
	return {
		status: row.status,
		attempts: row.attempt_count,
		result: row.result_json
			? (JSON.parse(row.result_json) as DiscordDeliveryResult)
			: undefined,
		error: row.error ?? undefined,
	};
}

export function recoverStuckDiscordDeliveries(): { retried: number; dead: number } {
	return recoverStuckDiscordDeliveriesInDb(getDb());
}

export function recoverStuckDiscordDeliveriesInDb(
	db: Database.Database,
	now = Date.now(),
): { retried: number; dead: number } {
	const cutoff = new Date(now - 2 * 60 * 1_000).toISOString().slice(0, 19).replace("T", " ");
	return db.transaction(() => {
		const dead = db
			.prepare(`
        update discord_delivery_queue
        set status = 'dead',
            error = 'Gateway stopped during delivery outside the Discord nonce recovery window',
            started_at = null,
            processed_at = datetime('now')
        where status = 'processing'
          and (started_at is null or started_at < ?)
      `)
			.run(cutoff).changes;
		const retried = db
			.prepare(`
      update discord_delivery_queue
      set status = 'pending', next_attempt_at = 0, started_at = null
      where status = 'processing'
    `)
			.run().changes;
		return { retried, dead };
	})();
}

export function getDiscordDeliveryBacklog(): { pending: number; dead: number } {
	const rows = getDb()
		.prepare(`
      select status, count(*) as count
      from discord_delivery_queue
      where status in ('pending', 'processing', 'dead')
      group by status
    `)
		.all() as Array<{ status: "pending" | "processing" | "dead"; count: number }>;
	let pending = 0;
	let dead = 0;
	for (const row of rows) {
		if (row.status === "dead") dead += row.count;
		else pending += row.count;
	}
	return { pending, dead };
}

export function deliveryNonceForKey(deliveryKey: string): string {
	return createHash("sha256").update(deliveryKey).digest("hex").slice(0, 24);
}

export function discordDeliveryRetryDelayMs(attempt: number): number {
	return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}
