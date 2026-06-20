import type { RegisteredChannel, ThinkingLevel } from "../types.js";
import { getDb } from "./connection.js";

interface ChannelRow {
	jid: string;
	name: string;
	folder: string;
	requires_trigger: number;
	is_main: number;
	model_override: string | null;
	thinking_override: string | null;
	cwd_override: string | null;
}

export function registerChannel(ch: RegisteredChannel): void {
	getDb().prepare(`
    insert into channels (jid, name, folder, requires_trigger, is_main, model_override, thinking_override, cwd_override)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(jid) do update set
      name = excluded.name,
      folder = excluded.folder,
      requires_trigger = excluded.requires_trigger,
      is_main = excluded.is_main,
      cwd_override = case
        when excluded.cwd_override != '' then excluded.cwd_override
        else channels.cwd_override
      end
  `).run(
		ch.jid,
		ch.name,
		ch.folder,
		ch.requiresTrigger ? 1 : 0,
		ch.isMain ? 1 : 0,
		ch.modelOverride || "",
		ch.thinkingOverride || "",
		ch.cwdOverride.trim(),
	);
}

export function unregisterChannel(jid: string): boolean {
	const result = getDb().prepare("delete from channels where jid = ?").run(jid);
	return result.changes > 0;
}

export function getChannel(jid: string): RegisteredChannel | undefined {
	const row = getDb()
		.prepare("select * from channels where jid = ?")
		.get(jid) as ChannelRow | undefined;
	return row ? rowToChannel(row) : undefined;
}

export function getAllChannels(): RegisteredChannel[] {
	const rows = getDb()
		.prepare("select * from channels order by created_at")
		.all() as ChannelRow[];
	return rows.map(rowToChannel);
}

export function createDmChannel(
	jid: string,
	userId: string,
	displayName: string,
): RegisteredChannel {
	return {
		jid,
		name: `DM:${displayName}`,
		folder: `dm_${userId}`,
		requiresTrigger: false,
		isMain: false,
		modelOverride: "",
		thinkingOverride: "",
		cwdOverride: "",
	};
}

export function setChannelModelOverride(
	jid: string,
	modelOverride: string,
): boolean {
	const result = getDb()
		.prepare("update channels set model_override = ? where jid = ?")
		.run(modelOverride.trim(), jid);
	return result.changes > 0;
}

export function clearChannelModelOverride(jid: string): boolean {
	const result = getDb()
		.prepare("update channels set model_override = '' where jid = ?")
		.run(jid);
	return result.changes > 0;
}

export function setChannelThinkingOverride(
	jid: string,
	thinkingOverride: ThinkingLevel,
): boolean {
	const result = getDb()
		.prepare("update channels set thinking_override = ? where jid = ?")
		.run(thinkingOverride, jid);
	return result.changes > 0;
}

export function clearChannelThinkingOverride(jid: string): boolean {
	const result = getDb()
		.prepare("update channels set thinking_override = '' where jid = ?")
		.run(jid);
	return result.changes > 0;
}

function rowToChannel(row: ChannelRow): RegisteredChannel {
	return {
		jid: row.jid,
		name: row.name,
		folder: row.folder,
		requiresTrigger: row.requires_trigger === 1,
		isMain: row.is_main === 1,
		modelOverride: row.model_override || "",
		thinkingOverride: (row.thinking_override || "") as ThinkingLevel | "",
		cwdOverride: row.cwd_override || "",
	};
}
