export interface ParsedDiscordReaction {
  handle: string;
  emoji: string;
}

export interface ParsedDiscordDirectives {
  text: string;
  reactions: ParsedDiscordReaction[];
}

const REACTION_DIRECTIVE = /^\[react\s+(m\d+):\s*(.+?)\]$/i;

export function buildReactionInstruction(): string {
  return 'Optional reaction directive: include one standalone line like [react m1: 😂] only for a shown message handle.';
}

export function extractDiscordDirectives(text: string): ParsedDiscordDirectives {
  const reactions: ParsedDiscordReaction[] = [];

  const keptLines = text
    .split(/\r?\n/u)
    .filter((line) => {
      const match = line.trim().match(REACTION_DIRECTIVE);
      if (!match) {
        return true;
      }

      const handle = (match[1] ?? '').trim().toLowerCase();
      const emoji = (match[2] ?? '').trim();
      if (handle && emoji) {
        reactions.push({ handle, emoji });
      }

      return false;
    });

  return {
    text: keptLines.join('\n').trim(),
    reactions,
  };
}

export function findInvalidReactionHandle(text: string, availableHandles: Set<string>): string | null {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.toLowerCase().startsWith('[react')) continue;

    const match = trimmed.match(REACTION_DIRECTIVE);
    if (!match) return trimmed;

    const handle = (match[1] ?? '').trim().toLowerCase();
    if (!availableHandles.has(handle)) return handle || trimmed;
  }

  return null;
}
