import type {
	DiscordDeliveryQueueState,
	DiscordDeliveryRequest,
	DiscordDeliveryResult,
} from "../delivery-types.js";
import type { QueuedDiscordDelivery } from "../types.js";
import { getDb } from "./connection.js";

export function enqueueDiscordDelivery(request: DiscordDeliveryRequest): number {
	const result = getDb()
		.prepare("insert into discord_delivery_queue (request_json) values (?)")
		.run(JSON.stringify(request));
	return Number(result.lastInsertRowid);
}

export function claimNextDiscordDelivery(): QueuedDiscordDelivery | undefined {
	return getDb()
		.prepare(`
      with next_delivery as (
        select rowid
        from discord_delivery_queue
        where status = 'pending'
        order by rowid asc
        limit 1
      )
      update discord_delivery_queue
      set status = 'processing'
      where rowid = (select rowid from next_delivery)
        and status = 'pending'
      returning rowid, request_json, status
    `)
		.get() as QueuedDiscordDelivery | undefined;
}

export function markDiscordDeliveryDone(rowid: number, result: DiscordDeliveryResult): void {
	getDb()
		.prepare(`
      update discord_delivery_queue
      set status = 'done', result_json = ?, error = null, processed_at = datetime('now')
      where rowid = ?
    `)
		.run(JSON.stringify(result), rowid);
}

export function markDiscordDeliveryFailed(rowid: number, error: string): void {
	getDb()
		.prepare(`
      update discord_delivery_queue
      set status = 'failed', error = ?, processed_at = datetime('now')
      where rowid = ?
    `)
		.run(error, rowid);
}

export function getDiscordDeliveryState(rowid: number): DiscordDeliveryQueueState | undefined {
	const row = getDb()
		.prepare("select status, result_json, error from discord_delivery_queue where rowid = ?")
		.get(rowid) as
		| { status: DiscordDeliveryQueueState["status"]; result_json: string | null; error: string | null }
		| undefined;
	if (!row) return undefined;
	return {
		status: row.status,
		result: row.result_json
			? (JSON.parse(row.result_json) as DiscordDeliveryResult)
			: undefined,
		error: row.error ?? undefined,
	};
}

export function recoverStuckDiscordDeliveries(): number {
	return getDb()
		.prepare("update discord_delivery_queue set status = 'pending' where status = 'processing'")
		.run().changes;
}
