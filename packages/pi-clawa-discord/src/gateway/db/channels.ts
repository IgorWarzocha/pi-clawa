import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import type { RegisteredChannel } from "../types.js";
import { getDb } from "./connection.js";

interface ChannelRow {
	jid: string;
	name: string;
	requires_trigger: number;
}

export function registerChannel(ch: RegisteredChannel): void {
	getDb().prepare(`
    insert into channels (jid, name, requires_trigger)
    values (?, ?, ?)
    on conflict(jid) do update set
      name = excluded.name,
      requires_trigger = excluded.requires_trigger
  `).run(
		ch.jid,
		ch.name,
		ch.requiresTrigger ? 1 : 0,
	);
	writeChannelsSnapshot();
}

export function getChannel(jid: string): RegisteredChannel | undefined {
	const row = getDb()
		.prepare("select jid, name, requires_trigger from channels where jid = ?")
		.get(jid) as ChannelRow | undefined;
	return row ? rowToChannel(row) : undefined;
}

export function getAllChannels(): RegisteredChannel[] {
	const rows = getDb()
		.prepare("select jid, name, requires_trigger from channels order by created_at")
		.all() as ChannelRow[];
	return rows.map(rowToChannel);
}

export function createDmChannel(
	jid: string,
	_userId: string,
	displayName: string,
): RegisteredChannel {
	return {
		jid,
		name: `DM:${displayName}`,
		requiresTrigger: false,
	};
}

function rowToChannel(row: ChannelRow): RegisteredChannel {
	return {
		jid: row.jid,
		name: row.name,
		requiresTrigger: row.requires_trigger === 1,
	};
}

export function writeChannelsSnapshot(): void {
	const channels = getAllChannels().map((channel) => {
		const isDm = channel.name.toLowerCase().startsWith("dm:");
		return {
			label: isDm ? "dm" : channelLabel(channel),
			kind: isDm ? "dm" : "channel",
			name: channel.name,
		};
	});
	mkdirSync(dirname(config.channelsPath), { recursive: true });
	writeFileSync(config.channelsPath, `${JSON.stringify({ channels }, null, 2)}\n`, "utf8");
}

function channelLabel(channel: RegisteredChannel): string {
	const hashIndex = channel.name.lastIndexOf("#");
	if (hashIndex !== -1) return channel.name.slice(hashIndex).trim().toLowerCase();
	return `#${channel.jid.replace(/^dc:/, "")}`.toLowerCase();
}
