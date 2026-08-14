import {
	PermissionFlagsBits,
	type GuildMember,
	type PartialGuildMember,
} from "discord.js";
import { resolveClawaWorkerForDiscordChannel } from "../channel-routes.js";
import { config } from "../config.js";
import {
	enqueueDiscordMembershipEvent,
	getChannel,
} from "../db.js";
import { logger } from "../logger.js";
import type { RegisteredChannel } from "../types.js";
import { sanitizeDiscordLabel } from "./sanitize.js";

export type DiscordMembershipAction = "joined" | "left";

export interface MembershipEventDependencies {
	getChannel(jid: string): RegisteredChannel | undefined;
	resolveWorker(jid: string): string | undefined;
	enqueue(event: {
		channelJid: string;
		eventId: string;
		content: string;
		timestamp: string;
	}): boolean;
	excludedChannels: ReadonlySet<string>;
}

const defaultDependencies: MembershipEventDependencies = {
	getChannel,
	resolveWorker: resolveClawaWorkerForDiscordChannel,
	enqueue: enqueueDiscordMembershipEvent,
	excludedChannels: config.excludedChannels,
};

export function handleGuildMembershipEvent(
	member: GuildMember | PartialGuildMember,
	action: DiscordMembershipAction,
	options: {
		now?: Date;
		dependencies?: MembershipEventDependencies;
	} = {},
): void {
	if (member.user.bot) return;

	const dependencies = options.dependencies ?? defaultDependencies;
	const occurredAt =
		action === "joined" && member.joinedAt
			? member.joinedAt
			: (options.now ?? new Date());
	const timestamp = occurredAt.toISOString();
	const memberName =
		sanitizeDiscordLabel(
			member.displayName || member.user.displayName || member.user.username,
		) || member.id;
	const eventId = [
		"discord-membership",
		member.guild.id,
		member.id,
		member.joinedTimestamp ?? "unknown",
		action,
	].join(":");
	const content = `Discord membership event: ${memberName} ${action} this server at ${timestamp}.`;
	let enqueued = 0;

	for (const channel of member.guild.channels.cache.values()) {
		if (!channel.isTextBased() || !("permissionsFor" in channel)) continue;
		if (dependencies.excludedChannels.has(channel.id)) continue;

		const jid = `dc:${channel.id}`;
		if (!dependencies.getChannel(jid)) continue;
		if (!dependencies.resolveWorker(jid)) continue;
		if (!channel.permissionsFor(member.id)?.has(PermissionFlagsBits.ViewChannel)) {
			continue;
		}

		if (
			dependencies.enqueue({
				channelJid: jid,
				eventId,
				content,
				timestamp,
			})
		) {
			enqueued += 1;
		}
	}

	logger.info(
		{
			action,
			guildId: member.guild.id,
			memberId: member.id,
			routedChannels: enqueued,
		},
		"Discord membership event observed",
	);
}
