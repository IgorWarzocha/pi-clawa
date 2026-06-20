export function shouldAcceptTriggeredMessage(
	content: string,
	opts: {
		requiresTrigger: boolean;
		isReplyToBot: boolean;
		triggerPattern: RegExp;
		triggerAliasPattern?: RegExp | null;
	},
): boolean {
	if (!opts.requiresTrigger) return true;
	if (opts.isReplyToBot) return true;
	if (opts.triggerAliasPattern?.test(content)) return true;
	return opts.triggerPattern.test(content);
}

export function shouldIgnoreExcludedGuildChannel(
	channelId: string,
	opts: { isDM: boolean; excludedChannels: ReadonlySet<string> },
): boolean {
	return !opts.isDM && opts.excludedChannels.has(channelId);
}

export function buildTriggerAliasPattern(aliases: string[]): RegExp | null {
	if (aliases.length === 0) return null;
	const parts = aliases
		.map((alias) => escapeRegExp(alias))
		.filter(Boolean)
		.map((alias) => `${alias}\\w*`);
	if (parts.length === 0) return null;
	return new RegExp(`\\b(?:${parts.join("|")})\\b`, "i");
}

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
