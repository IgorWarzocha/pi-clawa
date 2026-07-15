const DISCORD_MAX_LENGTH = 2_000;

export function splitDiscordMessage(text: string): string[] {
	const chunks: string[] = [];
	let remaining = text.trim();
	while (remaining.length > DISCORD_MAX_LENGTH) {
		let splitAt = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
		if (splitAt <= 0) splitAt = DISCORD_MAX_LENGTH;
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).replace(/^\n/u, "");
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}
