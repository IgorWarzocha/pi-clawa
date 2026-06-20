export interface ParsedDiscordDirectives {
  text: string;
  reaction: string | null;
}

const REACTION_DIRECTIVE = /^\[React:\s*(.+?)\]$/i;

export function buildReactionInstruction(): string {
  return 'Optional reaction directive: include one standalone line like [React: 😂] only when a single tasteful reaction genuinely adds something.';
}

export function extractDiscordDirectives(text: string): ParsedDiscordDirectives {
  let reaction: string | null = null;

  const keptLines = text
    .split(/\r?\n/u)
    .filter((line) => {
      const match = line.trim().match(REACTION_DIRECTIVE);
      if (!match) {
        return true;
      }

		if (!reaction) {
			reaction = (match[1] ?? '').trim();
		}

      return false;
    });

  return {
    text: keptLines.join('\n').trim(),
    reaction,
  };
}
