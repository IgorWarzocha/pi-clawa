import {
	isRegisteredDiscordDm,
	resolveClawaWorkerForDiscordChannel,
	resolveRoutedDiscordChannel,
} from '../channel-routes.js';

export type FinalRouteTarget =
	| { kind: 'channel'; label: string }
	| { kind: 'dm' }
	| { kind: 'main-clawa' }
	| { kind: 'quiet' };

export interface FinalRouteBlock {
	target: FinalRouteTarget;
	text: string;
}

export interface ParsedFinalRoutes {
	hasRoutes: boolean;
	blocks: FinalRouteBlock[];
}

const ROUTE_TAG_REGEX = /^\[(#[^\]\s:]+|dm|main_clawa|quiet)\]:?\s*(.*)$/i;
const REACTION_DIRECTIVE_REGEX = /^\[react\s+m\d+:\s*.+?\]$/i;

export function parseFinalRoutes(text: string): ParsedFinalRoutes {
	const blocks: FinalRouteBlock[] = [];
	let current: FinalRouteBlock | undefined;
	let hasRoutes = false;
	const pendingLeadingDirectives: string[] = [];

	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trimEnd();
		const match = line.trimStart().match(ROUTE_TAG_REGEX);
		if (match) {
			hasRoutes = true;
			if (current) blocks.push(trimBlock(current));
			const initialText = [
				...pendingLeadingDirectives.splice(0),
				match[2]?.trim() ?? '',
			].filter(Boolean).join('\n');
			current = {
				target: parseRouteTarget(match[1] ?? ''),
				text: initialText,
			};
			continue;
		}

		if (!current) {
			if (REACTION_DIRECTIVE_REGEX.test(line.trim())) {
				pendingLeadingDirectives.push(line.trim());
			}
			continue;
		}
		current.text = current.text ? `${current.text}\n${line}` : line;
	}

	if (current) blocks.push(trimBlock(current));

	return {
		hasRoutes,
		blocks: blocks.filter((block) => block.target.kind === 'quiet' || block.text.trim()),
	};
}

export function resolveDiscordRouteTarget(
	target: FinalRouteTarget,
	context: { workerId?: string | undefined; sourceJid?: string | null | undefined } = {},
): string | undefined {
	if (target.kind === 'channel') {
		return resolveRoutedDiscordChannel(target.label, context.workerId);
	}
	if (target.kind === 'dm') {
		if (
			context.sourceJid &&
			isRegisteredDiscordDm(context.sourceJid) &&
			resolveClawaWorkerForDiscordChannel(context.sourceJid) === context.workerId
		) {
			return context.sourceJid;
		}
		return resolveRoutedDiscordChannel('dm', context.workerId);
	}
	return undefined;
}

export function resolveDiscordChannelLabel(input: string, workerId?: string | undefined): string | undefined {
	const value = input.trim();
	if (!value) return undefined;
	return resolveRoutedDiscordChannel(value, workerId);
}

function parseRouteTarget(raw: string): FinalRouteTarget {
	const value = raw.trim().toLowerCase();
	if (value === 'dm') return { kind: 'dm' };
	if (value === 'main_clawa') return { kind: 'main-clawa' };
	if (value === 'quiet') return { kind: 'quiet' };
	return { kind: 'channel', label: value };
}

function trimBlock(block: FinalRouteBlock): FinalRouteBlock {
	return { ...block, text: block.text.trim() };
}
