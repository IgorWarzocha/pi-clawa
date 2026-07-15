import { createHash, randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	FileBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	PermissionFlagsBits,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	type Client,
	type DMChannel,
	type MessageCreateOptions,
	type TextChannel,
	TextDisplayBuilder,
} from "discord.js";
import type {
	DiscordActionInput,
	DiscordDeliveryRequest,
	DiscordDeliveryResult,
	DiscordFileInput,
} from "../delivery-types.js";
import { replacePlainUserMentions, type MentionCandidate } from "./mentions.js";
import { splitDiscordMessage } from "./text.js";
import { validateDiscordDeliveryRequest } from "../delivery-types.js";
import { config } from "../config.js";
import {
	attachDiscordInteractionMessage,
	deleteDiscordInteractions,
	storeDiscordInteraction,
} from "../db.js";
import type {
	DiscordModalActionPayload,
	DiscordPromptActionPayload,
	DiscordSelectActionPayload,
} from "./interaction-payloads.js";

const MAX_PLAIN_TEXT = 2_000;
const INTERACTION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const IMAGE_EXTENSION = /^\.(?:avif|gif|jpe?g|png|webp)$/iu;

interface PreparedFile {
	input: DiscordFileInput;
	name: string;
	attachment: AttachmentBuilder;
}

interface PreparedComponents {
	rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
	tokens: string[];
}

export async function sendDiscordDeliveryWithClient(
	client: Client | null,
	request: DiscordDeliveryRequest,
	nonce: string,
): Promise<DiscordDeliveryResult> {
	if (!client) throw new Error("Discord gateway is not connected.");
	validateDiscordDeliveryRequest(request, {
		maxAttachmentBytes: config.maxAttachmentBytes,
		maxTotalAttachmentBytes: config.maxTotalAttachmentBytes,
		fileStat: (filePath) => statSync(filePath),
	});

	const channelId = request.channelJid.replace(/^dc:/u, "");
	const channel = await client.channels.fetch(channelId);
	if (!channel || !("send" in channel)) {
		throw new Error(`Discord channel is unavailable: ${request.channelJid}`);
	}
	const textChannel = channel as TextChannel | DMChannel;
	const resolvedRequest: DiscordDeliveryRequest = {
		...request,
		text: request.text
			? await resolveOutgoingMentions(textChannel, request.text)
			: undefined,
	};

	let reacted = false;
	if (request.reaction) {
		reacted = await deliverReaction(client, request.reaction);
	}

	const hasMessage = Boolean(
		request.text?.trim() ||
			request.title?.trim() ||
			request.files.length > 0 ||
			request.actions?.length ||
			request.select ||
			request.poll,
	);
	if (!hasMessage) {
		return { sentFiles: 0, sentText: false, reacted };
	}
	if (isPlainTextDelivery(resolvedRequest)) {
		return await sendPlainTextDelivery(textChannel, resolvedRequest, nonce, reacted);
	}

	const preparedFiles = await prepareFiles(resolvedRequest.files);
	const interactive = prepareInteractiveComponents(resolvedRequest);
	try {
		const payload = resolvedRequest.card
			? buildCardPayload(resolvedRequest, preparedFiles, interactive.rows, nonce)
			: buildPlainPayload(resolvedRequest, preparedFiles, interactive.rows, nonce);
		const message = await textChannel.send(payload);
		attachDiscordInteractionMessage(interactive.tokens, message.id);
		return {
			messageId: message.id,
			sentFiles: preparedFiles.length,
			sentText: Boolean(request.text?.trim() || request.title?.trim()),
			reacted,
		};
	} catch (error) {
		deleteDiscordInteractions(interactive.tokens);
		throw error;
	}
}

function isPlainTextDelivery(request: DiscordDeliveryRequest): boolean {
	return Boolean(
		request.text?.trim() &&
			!request.title?.trim() &&
			!request.card &&
			request.files.length === 0 &&
			!request.actions?.length &&
			!request.select &&
			!request.poll,
	);
}

async function sendPlainTextDelivery(
	channel: TextChannel | DMChannel,
	request: DiscordDeliveryRequest,
	nonce: string,
	reacted: boolean,
): Promise<DiscordDeliveryResult> {
	const chunks = splitDiscordMessage(request.text ?? "");
	let messageId: string | undefined;
	for (const [index, chunk] of chunks.entries()) {
		const message = await channel.send({
			content: chunk,
			nonce: chunks.length === 1 ? nonce : childNonce(nonce, index),
			enforceNonce: true,
			allowedMentions: { parse: ["users"], repliedUser: false },
			...(index === 0 && request.replyToMessageId
				? {
						reply: {
							messageReference: request.replyToMessageId,
							failIfNotExists: false,
						},
					}
				: {}),
		});
		messageId = message.id;
	}
	return { messageId, sentFiles: 0, sentText: chunks.length > 0, reacted };
}

function childNonce(nonce: string, index: number): string {
	return createHash("sha256").update(`${nonce}:${index}`).digest("hex").slice(0, 24);
}

async function resolveOutgoingMentions(
	channel: TextChannel | DMChannel,
	text: string,
): Promise<string> {
	if (!("guild" in channel)) return text;
	try {
		const members = [...channel.guild.members.cache.values()]
			.filter((member) => !member.user.bot)
			.filter((member) =>
				channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel),
			);
		const candidates: MentionCandidate[] = members.map((member) => ({
			id: member.id,
			names: [
				member.displayName,
				member.user.globalName ?? "",
				member.user.username,
			],
		}));
		return candidates.length > 0 ? replacePlainUserMentions(text, candidates) : text;
	} catch {
		return text;
	}
}

function buildPlainPayload(
	request: DiscordDeliveryRequest,
	files: PreparedFile[],
	rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[],
	nonce: string,
): MessageCreateOptions {
	const content = formatDeliveryText(request);
	if (content.length > MAX_PLAIN_TEXT) {
		throw new Error(`Discord messages with files or interactions must fit ${MAX_PLAIN_TEXT} characters.`);
	}
	return {
		nonce,
		enforceNonce: true,
		...(content ? { content } : {}),
		...(files.length > 0 ? { files: files.map((file) => file.attachment) } : {}),
		...(rows.length > 0 ? { components: rows } : {}),
		...(request.poll
			? {
					poll: {
						question: { text: request.poll.question },
						answers: request.poll.answers.map((answer) => ({ text: answer })),
						duration: request.poll.durationHours ?? 24,
						allowMultiselect: request.poll.allowMultiselect ?? false,
					},
				}
			: {}),
		allowedMentions: { parse: ["users"], repliedUser: false },
		...(request.replyToMessageId
			? {
					reply: {
						messageReference: request.replyToMessageId,
						failIfNotExists: false,
					},
				}
			: {}),
	};
}

function buildCardPayload(
	request: DiscordDeliveryRequest,
	files: PreparedFile[],
	rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[],
	nonce: string,
): MessageCreateOptions {
	const container = new ContainerBuilder().setAccentColor(0x9b7edb);
	const text = formatDeliveryText(request);
	if (text) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

	const images = files.filter((file) => IMAGE_EXTENSION.test(extname(file.name)));
	if (images.length > 0) {
		const gallery = new MediaGalleryBuilder();
		gallery.addItems(
			...images.map((file) => {
				const item = new MediaGalleryItemBuilder().setURL(`attachment://${file.name}`);
				if (file.input.description) item.setDescription(file.input.description);
				if (file.input.spoiler) item.setSpoiler(true);
				return item;
			}),
		);
		container.addMediaGalleryComponents(gallery);
	}

	for (const file of files.filter((item) => !IMAGE_EXTENSION.test(extname(item.name)))) {
		container.addFileComponents(
			new FileBuilder().setURL(`attachment://${file.name}`).setSpoiler(file.input.spoiler),
		);
	}
	for (const row of rows) container.addActionRowComponents(row);

	return {
		nonce,
		enforceNonce: true,
		flags: MessageFlags.IsComponentsV2,
		components: [container],
		files: files.map((file) => file.attachment),
		allowedMentions: { parse: ["users"], repliedUser: false },
		...(request.replyToMessageId
			? {
					reply: {
						messageReference: request.replyToMessageId,
						failIfNotExists: false,
					},
				}
			: {}),
	};
}

function prepareInteractiveComponents(request: DiscordDeliveryRequest): PreparedComponents {
	const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
	const tokens: string[] = [];
	if ((request.actions?.length ?? 0) > 0) {
		const row = new ActionRowBuilder<ButtonBuilder>();
		for (const action of request.actions ?? []) {
			const button = prepareButton(request.channelJid, action, tokens);
			row.addComponents(button);
		}
		rows.push(row);
	}
	if (request.select) {
		const token = interactionToken();
		const options = Object.fromEntries(
			request.select.options.map((option, index) => [
				String(index),
				{
					label: option.label,
					prompt: option.prompt?.trim() || `I chose “${option.label}”.`,
				},
			]),
		);
		const payload: DiscordSelectActionPayload = { type: "select", options };
		storeAction(token, request.channelJid, "select", payload);
		tokens.push(token);

		const select = new StringSelectMenuBuilder()
			.setCustomId(`clawa:select:${token}`)
			.setPlaceholder(request.select.placeholder)
			.setMinValues(request.select.minValues ?? 1)
			.setMaxValues(request.select.maxValues ?? 1)
			.addOptions(
				...request.select.options.map((option, index) => {
					const item = new StringSelectMenuOptionBuilder()
						.setLabel(option.label)
						.setValue(String(index));
					if (option.description) item.setDescription(option.description);
					return item;
				}),
			);
		rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
	}
	return { rows, tokens };
}

function prepareButton(channelJid: string, action: DiscordActionInput, tokens: string[]): ButtonBuilder {
	const button = new ButtonBuilder().setLabel(action.label);
	if (action.url) {
		return button.setStyle(ButtonStyle.Link).setURL(action.url);
	}

	const token = interactionToken();
	tokens.push(token);
	if (action.modal) {
		const payload: DiscordModalActionPayload = {
			type: "modal",
			label: action.label,
			title: action.modal.title,
			inputLabel: action.modal.label,
			prompt: action.modal.prompt?.trim() || `I chose “${action.label}” and added:`,
			placeholder: action.modal.placeholder,
			required: action.modal.required ?? true,
		};
		storeAction(token, channelJid, "modal", payload);
		button.setCustomId(`clawa:modal:${token}`);
	} else {
		const payload: DiscordPromptActionPayload = {
			type: "prompt",
			label: action.label,
			prompt: action.prompt?.trim() || `I chose “${action.label}”.`,
		};
		storeAction(token, channelJid, "button", payload);
		button.setCustomId(`clawa:button:${token}`);
	}
	return button.setStyle(resolveButtonStyle(action.style));
}

function storeAction(
	token: string,
	channelJid: string,
	kind: "button" | "select" | "modal",
	payload: DiscordPromptActionPayload | DiscordModalActionPayload | DiscordSelectActionPayload,
): void {
	storeDiscordInteraction({
		token,
		channelJid,
		kind,
		payload,
		expiresAt: Date.now() + INTERACTION_TTL_MS,
	});
}

function resolveButtonStyle(style: DiscordActionInput["style"]): ButtonStyle {
	switch (style) {
		case "primary":
			return ButtonStyle.Primary;
		case "success":
			return ButtonStyle.Success;
		case "danger":
			return ButtonStyle.Danger;
		default:
			return ButtonStyle.Secondary;
	}
}

async function prepareFiles(files: DiscordFileInput[]): Promise<PreparedFile[]> {
	const usedNames = new Set<string>();
	return await Promise.all(
		files.map(async (input, index) => {
			const original = basename(input.path);
			const name = uniqueAttachmentName(input.spoiler ? `SPOILER_${original}` : original, index, usedNames);
			const attachment = new AttachmentBuilder(await readFile(input.path), { name });
			if (input.description) attachment.setDescription(input.description);
			return { input, name, attachment };
		}),
	);
}

function uniqueAttachmentName(name: string, index: number, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name);
		return name;
	}
	const extension = extname(name);
	const stem = name.slice(0, name.length - extension.length);
	const unique = `${stem}-${index + 1}${extension}`;
	used.add(unique);
	return unique;
}

async function deliverReaction(
	client: Client,
	reaction: NonNullable<DiscordDeliveryRequest["reaction"]>,
): Promise<boolean> {
	try {
		const channel = await client.channels.fetch(reaction.channelJid.replace(/^dc:/u, ""));
		if (!channel || !("messages" in channel)) return false;
		const message = await (channel as TextChannel | DMChannel).messages.fetch(reaction.messageId);
		await message.react(reaction.emoji);
		return true;
	} catch {
		return false;
	}
}

function formatDeliveryText(request: DiscordDeliveryRequest): string {
	return [request.title?.trim() ? `# ${request.title.trim()}` : "", request.text?.trim() ?? ""]
		.filter(Boolean)
		.join("\n\n");
}

function interactionToken(): string {
	return randomBytes(12).toString("base64url");
}
