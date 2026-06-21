export interface MentionCandidate {
	id: string;
	names: string[];
}

import { sanitizeDiscordLabel } from './sanitize.js';

const PLAIN_USER_MENTION = /(^|[\s([{"'`])@([A-Za-z0-9._-]{2,32})\b/g;

export function replacePlainUserMentions(text: string, candidates: MentionCandidate[]): string {
  if (!text.includes('@')) return text;

  const lookup = buildLookup(candidates);

  return text.replace(PLAIN_USER_MENTION, (match, prefix: string, rawName: string) => {
    const normalized = normalizeName(rawName);
    const matches = lookup.get(normalized);
    if (!matches || matches.length !== 1) {
      return match;
    }

    return `${prefix}<@${matches[0]}>`;
  });
}

function buildLookup(candidates: MentionCandidate[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();

  for (const candidate of candidates) {
    const uniqueNames = [...new Set(candidate.names.map(normalizeName).filter(Boolean))];
    for (const name of uniqueNames) {
      const existing = lookup.get(name) ?? [];
      if (!existing.includes(candidate.id)) {
        existing.push(candidate.id);
        lookup.set(name, existing);
      }
    }
  }

  return lookup;
}

function normalizeName(value: string): string {
	return sanitizeDiscordLabel(value).toLowerCase();
}
