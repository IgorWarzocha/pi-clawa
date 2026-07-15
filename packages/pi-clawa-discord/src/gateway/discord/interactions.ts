import {
	ActionRowBuilder,
	type ButtonInteraction,
	type MessageContextMenuCommandInteraction,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	type StringSelectMenuInteraction,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import {
	enqueueDiscordInteractionTurn,
	getChannel,
	getDiscordInteraction,
} from "../db.js";
import type { StoredDiscordInteraction } from "../types.js";
import type { DiscordInteractionPayload, DiscordModalActionPayload } from "./interaction-payloads.js";

const COMPONENT_ID = /^clawa:(button|modal|select):([A-Za-z0-9_-]+)$/u;
const MODAL_SUBMIT_ID = /^clawa:modal-submit:([A-Za-z0-9_-]+)$/u;
const ASK_MODAL_ID = /^clawa:ask:([0-9]+)$/u;
const MODAL_FIELD_ID = "clawa-input";

export async function handleDiscordButton(interaction: ButtonInteraction): Promise<void> {
	const match = interaction.customId.match(COMPONENT_ID);
	if (!match) return;
	const token = match[2];
	if (!token) return;
	const stored = validStoredInteraction(token, interaction.channelId, interaction.message.id);
	if (!stored) {
		await replyUnavailable(interaction);
		return;
	}
	const payload = parsePayload(stored);
	if (payload.type === "modal") {
		await interaction.showModal(buildActionModal(token, payload));
		return;
	}
	if (
		payload.type !== "prompt" ||
		!enqueueInteractionTurn(interaction, payload.prompt, interaction.message.id, token)
	) {
		await replyUnavailable(interaction);
		return;
	}
	await interaction.deferUpdate();
}

export async function handleDiscordSelect(
	interaction: StringSelectMenuInteraction,
): Promise<void> {
	const match = interaction.customId.match(COMPONENT_ID);
	if (!match) return;
	const token = match[2];
	if (!token) return;
	const stored = validStoredInteraction(token, interaction.channelId, interaction.message.id);
	if (!stored) {
		await replyUnavailable(interaction);
		return;
	}
	const payload = parsePayload(stored);
	if (payload.type !== "select") {
		await replyUnavailable(interaction);
		return;
	}
	const prompts = interaction.values
		.map((value) => payload.options[value]?.prompt)
		.filter((value): value is string => Boolean(value));
	if (prompts.length === 0) {
		await replyUnavailable(interaction);
		return;
	}
	if (!enqueueInteractionTurn(interaction, prompts.join("\n"), interaction.message.id, token)) {
		await replyUnavailable(interaction);
		return;
	}
	await interaction.deferUpdate();
}

export async function handleDiscordModal(interaction: ModalSubmitInteraction): Promise<void> {
	const askMatch = interaction.customId.match(ASK_MODAL_ID);
	if (askMatch?.[1]) {
		await handleAskModal(interaction, askMatch[1]);
		return;
	}

	const match = interaction.customId.match(MODAL_SUBMIT_ID);
	const token = match?.[1];
	if (!token || !interaction.channelId) return;
	const stored = validStoredInteraction(token, interaction.channelId);
	if (!stored) {
		await replyUnavailable(interaction);
		return;
	}
	const payload = parsePayload(stored);
	if (payload.type !== "modal") {
		await replyUnavailable(interaction);
		return;
	}
	const answer = interaction.fields.getTextInputValue(MODAL_FIELD_ID).trim();
	const prompt = answer ? `${payload.prompt}\n${answer}` : payload.prompt;
	if (!enqueueInteractionTurn(interaction, prompt, stored.message_id ?? undefined, token)) {
		await replyUnavailable(interaction);
		return;
	}
	await interaction.deferReply(ephemeral(interaction.inGuild()));
	await interaction.editReply("Passed to Clawa.");
}

export async function handleAskClawaCommand(
	interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
	if (!getChannel(`dc:${interaction.channelId}`)) {
		await interaction.reply({
			content: "This channel is not routed to a Clawa yet.",
			...ephemeral(interaction.inGuild()),
		});
		return;
	}
	const modal = new ModalBuilder()
		.setCustomId(`clawa:ask:${interaction.targetId}`)
		.setTitle("Ask Clawa about this")
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(MODAL_FIELD_ID)
					.setLabel("What would you like to know?")
					.setStyle(TextInputStyle.Paragraph)
					.setRequired(true)
					.setMaxLength(2_000),
			),
		);
	await interaction.showModal(modal);
}

async function handleAskModal(interaction: ModalSubmitInteraction, messageId: string): Promise<void> {
	if (!interaction.channel || !("messages" in interaction.channel)) {
		await replyUnavailable(interaction);
		return;
	}
	const target = await interaction.channel.messages.fetch(messageId).catch(() => null);
	if (!target) {
		await replyUnavailable(interaction);
		return;
	}
	const question = interaction.fields.getTextInputValue(MODAL_FIELD_ID).trim();
	const attachmentLines = [...target.attachments.values()].map(
		(attachment) => `- ${attachment.name}: ${attachment.url}`,
	);
	const prompt = [
		"[Discord message context request]",
		`${interaction.user.displayName} asks: ${question}`,
		`Message by ${target.author.displayName || target.author.username}:`,
		target.content || "[No text]",
		...(attachmentLines.length > 0 ? ["Attachments:", ...attachmentLines] : []),
	].join("\n");
	await interaction.deferReply(ephemeral(interaction.inGuild()));
	enqueueInteractionTurn(interaction, prompt, target.id);
	await interaction.editReply("Passed to Clawa.");
}

function enqueueInteractionTurn(
	interaction:
		| ButtonInteraction
		| StringSelectMenuInteraction
		| ModalSubmitInteraction,
	prompt: string,
	replyToMessageId?: string,
	token?: string,
): boolean {
	const jid = `dc:${interaction.channelId}`;
	const channel = getChannel(jid);
	if (!channel) throw new Error("Discord interaction channel is not registered.");
	const senderName = interaction.user.displayName || interaction.user.username;
	return enqueueDiscordInteractionTurn({
		token,
		channelJid: jid,
		senderId: interaction.user.id,
		senderName,
		sourceMessageId: interaction.id,
		replyToMessageId,
		content: prompt,
		timestamp: new Date().toISOString(),
	});
}

function validStoredInteraction(
	token: string,
	channelId: string,
	messageId?: string,
): StoredDiscordInteraction | undefined {
	const stored = getDiscordInteraction(token);
	if (!stored || stored.expires_at <= Date.now() || stored.consumed_at) return undefined;
	if (stored.channel_jid !== `dc:${channelId}`) return undefined;
	if (messageId && stored.message_id && stored.message_id !== messageId) return undefined;
	return stored;
}

function parsePayload(stored: StoredDiscordInteraction): DiscordInteractionPayload {
	return JSON.parse(stored.payload_json) as DiscordInteractionPayload;
}

function buildActionModal(token: string, payload: DiscordModalActionPayload): ModalBuilder {
	const input = new TextInputBuilder()
		.setCustomId(MODAL_FIELD_ID)
		.setLabel(payload.inputLabel)
		.setStyle(TextInputStyle.Paragraph)
		.setRequired(payload.required)
		.setMaxLength(4_000);
	if (payload.placeholder) input.setPlaceholder(payload.placeholder);
	return new ModalBuilder()
		.setCustomId(`clawa:modal-submit:${token}`)
		.setTitle(payload.title)
		.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

async function replyUnavailable(
	interaction:
		| ButtonInteraction
		| StringSelectMenuInteraction
		| ModalSubmitInteraction,
): Promise<void> {
	if (interaction.replied || interaction.deferred) return;
	await interaction.reply({
		content: "That Clawa action has expired or was already used.",
		...ephemeral(interaction.inGuild()),
	});
}

function ephemeral(inGuild: boolean): { flags?: MessageFlags.Ephemeral } {
	return inGuild ? { flags: MessageFlags.Ephemeral } : {};
}
