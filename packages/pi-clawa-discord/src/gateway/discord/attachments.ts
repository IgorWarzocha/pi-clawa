import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { sanitizeDiscordLabel, sanitizeDiscordText } from './sanitize.js';

export interface AttachmentMeta {
	url: string;
	name: string;
	contentType: string;
	size: number;
	localPath?: string | undefined;
}

export interface LinkMeta {
	url: string;
	title?: string | undefined;
	description?: string | undefined;
}

interface DiscordEmbedLike {
	url?: string | null | undefined;
	title?: string | null | undefined;
	description?: string | null | undefined;
}

export interface AttachmentLimits {
	maxFileBytes: number;
	maxTotalBytes: number;
}

export type AttachmentRejectionReason = 'file-too-large' | 'total-too-large';

export interface RejectedAttachment {
	attachment: AttachmentMeta;
	reason: AttachmentRejectionReason;
	limitBytes: number;
}

export interface AttachmentSelection {
	accepted: AttachmentMeta[];
	rejected: RejectedAttachment[];
	totalAcceptedBytes: number;
}

export function selectAttachmentsWithinLimits(
	attachments: AttachmentMeta[],
	limits: AttachmentLimits,
): AttachmentSelection {
	const accepted: AttachmentMeta[] = [];
	const rejected: RejectedAttachment[] = [];
	let totalAcceptedBytes = 0;

	for (const attachment of attachments) {
		if (limits.maxFileBytes > 0 && attachment.size > limits.maxFileBytes) {
			rejected.push({
				attachment,
				reason: 'file-too-large',
				limitBytes: limits.maxFileBytes,
			});
			continue;
		}

		if (
			limits.maxTotalBytes > 0 &&
			totalAcceptedBytes + attachment.size > limits.maxTotalBytes
		) {
			rejected.push({
				attachment,
				reason: 'total-too-large',
				limitBytes: limits.maxTotalBytes,
			});
			continue;
		}

		accepted.push(attachment);
		totalAcceptedBytes += attachment.size;
	}

	return { accepted, rejected, totalAcceptedBytes };
}

export function buildAttachmentOnlyPrompt(attachmentCount: number): string {
	if (attachmentCount <= 1) {
		return '[Attachment-only message: 1 file attached.]';
	}

	return `[Attachment-only message: ${attachmentCount} files attached.]`;
}

function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateParts(date: Date): { year: string; month: string; day: string } {
	return {
		year: String(date.getUTCFullYear()),
		month: String(date.getUTCMonth() + 1).padStart(2, '0'),
		day: String(date.getUTCDate()).padStart(2, '0'),
	};
}

function monthDir(date: Date): string {
	const parts = dateParts(date);
	return join(config.assetsDir, parts.year, parts.month);
}

function attachmentKind(contentType: string): 'images' | 'videos' | 'files' {
	const type = contentType.toLowerCase();
	if (type.startsWith('image/')) return 'images';
	if (type.startsWith('video/')) return 'videos';
	return 'files';
}

function extensionForAttachment(attachment: AttachmentMeta): string {
	const type = attachment.contentType.toLowerCase();
	if (type === 'image/jpeg') return '.jpg';
	if (type === 'image/png') return '.png';
	if (type === 'image/webp') return '.webp';
	if (type === 'image/gif') return '.gif';
	if (type === 'video/mp4') return '.mp4';
	if (type === 'video/webm') return '.webm';
	const ext = extname(attachment.name || '').toLowerCase();
	return ext.replace(/[^a-z0-9.]/gu, '').slice(0, 16);
}

function localAttachmentFileName(createdAt: Date, messageId: string, index: number, attachment: AttachmentMeta): string {
	const parts = dateParts(createdAt);
	return `${parts.year}-${parts.month}-${parts.day}-${messageId}-a${index + 1}${extensionForAttachment(attachment)}`;
}

export async function cacheDiscordAttachments(
	messageId: string,
	createdAt: Date,
	attachments: AttachmentMeta[],
): Promise<AttachmentMeta[]> {
	if (attachments.length === 0) return [];

	return await Promise.all(
		attachments.map(async (attachment, index) => {
			const dir = join(monthDir(createdAt), attachmentKind(attachment.contentType));
			mkdirSync(dir, { recursive: true });
			const localPath = join(dir, localAttachmentFileName(createdAt, messageId, index, attachment));
			const response = await fetch(attachment.url);
			if (!response.ok) {
				throw new Error(`Failed to download Discord attachment ${attachment.name}: HTTP ${response.status}`);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			writeFileSync(localPath, bytes);
			return { ...attachment, localPath };
		}),
	);
}

export function extractDiscordLinks(content: string): string[] {
	const links: string[] = [];
	const seen = new Set<string>();
	const matches = content.matchAll(/https?:\/\/[^\s<>()]+/giu);
	for (const match of matches) {
		const raw = (match[0] ?? '').replace(/[),.;!?]+$/u, '');
		if (!raw || seen.has(raw)) continue;
		seen.add(raw);
		links.push(raw);
	}
	return links;
}

function sameUrl(a: string, b: string): boolean {
	try {
		const left = new URL(a);
		const right = new URL(b);
		left.hash = '';
		right.hash = '';
		return left.toString() === right.toString();
	} catch {
		return a === b;
	}
}

function cleanEmbedText(value: string | null | undefined): string | undefined {
	const text = sanitizeDiscordText(value ?? '').replace(/\s+/gu, ' ').trim();
	return text || undefined;
}

export function buildLinkMetas(content: string, embeds: readonly DiscordEmbedLike[] = []): LinkMeta[] {
	return extractDiscordLinks(content).map((url) => {
		const embed = embeds.find((item) => item.url && sameUrl(item.url, url));
		return {
			url,
			title: cleanEmbedText(embed?.title),
			description: cleanEmbedText(embed?.description),
		};
	});
}

export function buildLinkReferenceBlock(links: LinkMeta[]): string {
	if (links.length === 0) return '';
	return [
		'Message links:',
		...links.flatMap((link, index) => {
			const lines = [`[l${index + 1}] ${link.url}`];
			if (link.title) lines.push(`     title: ${link.title}`);
			if (link.description) lines.push(`     about: ${link.description}`);
			return lines;
		}),
	].join('\n');
}

function attachmentSummary(attachment: AttachmentMeta, index: number): string {
	const contentType = attachment.contentType || 'file';
	const type = contentType.toLowerCase();
	const name = sanitizeDiscordLabel(attachment.name || 'file') || 'file';
	if (type.startsWith('image/') || type.startsWith('video/')) {
		return `[a${index + 1}] ${contentType} — ${formatBytes(attachment.size)}`;
	}
	return `[a${index + 1}] ${name} — ${contentType} — ${formatBytes(attachment.size)}`;
}

export function buildAttachmentReferenceBlock(
	attachments: AttachmentMeta[],
): string {
	if (attachments.length === 0) {
		return '';
	}

	return [
		'Message attachments:',
		...attachments.flatMap((attachment, index) => {
			const lines = [attachmentSummary(attachment, index)];
			if (attachment.localPath) lines.push(`     path: ${attachment.localPath}`);
			return lines;
		}),
	].join('\n');
}

export function appendDiscordReferences(
	content: string,
	attachments: AttachmentMeta[],
	links: LinkMeta[] = buildLinkMetas(content),
): string {
	const blocks = [
		buildAttachmentReferenceBlock(attachments),
		buildLinkReferenceBlock(links),
	].filter(Boolean);
	const trimmed = content.trim();
	if (blocks.length === 0) return trimmed;
	return [trimmed, ...blocks].filter(Boolean).join('\n');
}

function markdownLink(link: LinkMeta): string {
	const label = link.title?.replace(/[\[\]]/gu, '') || link.url;
	return link.description ? `[${label}](${link.url}) — ${link.description}` : `[${label}](${link.url})`;
}

export async function appendDiscordLinksIndex(options: {
	createdAt: Date;
	senderName: string;
	channelName?: string | undefined;
	links: LinkMeta[];
}): Promise<void> {
	if (options.links.length === 0) return;
	const dir = monthDir(options.createdAt);
	mkdirSync(dir, { recursive: true });
	const timestamp = options.createdAt.toISOString();
	const channel = options.channelName ? ` — ${options.channelName}` : '';
	const lines = options.links.map((link) => `- ${timestamp} — ${options.senderName}${channel} — ${markdownLink(link)}`);
	await appendFile(join(dir, 'links.md'), `${lines.join('\n')}\n`, 'utf8');
}

function parseAssetDay(year: string, month: string, day: string): number | null {
	if (!/^\d{4}$/u.test(year) || !/^\d{2}$/u.test(month) || !/^\d{2}$/u.test(day)) return null;
	const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
	return Number.isFinite(time) ? time : null;
}

function parseAssetFileDate(fileName: string): number | null {
	const match = fileName.match(/^(\d{4})-(\d{2})-(\d{2})-/u);
	if (!match) return null;
	return parseAssetDay(match[1] ?? '', match[2] ?? '', match[3] ?? '');
}

export function cleanupOldDiscordMediaAssets(now = new Date()): void {
	const retentionDays = config.attachmentsRetentionDays;
	const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
		(retentionDays - 1) * 24 * 60 * 60 * 1000;

	for (const year of readdirSafe(config.assetsDir)) {
		for (const month of readdirSafe(join(config.assetsDir, year))) {
			for (const kind of ['images', 'videos', 'files']) {
				const kindDir = join(config.assetsDir, year, month, kind);
				for (const file of readdirFilesSafe(kindDir)) {
					const fileTime = parseAssetFileDate(file);
					if (fileTime === null || fileTime >= cutoff) continue;
					rmSync(join(kindDir, file), { force: true });
					logger.info({ file, kind }, 'Removed old Discord media asset');
				}
			}
		}
	}
}

function readdirFilesSafe(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

function readdirSafe(path: string): string[] {
	try {
		return readdirSync(path, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}
