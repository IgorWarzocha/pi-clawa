export interface DiscordPromptActionPayload {
	type: "prompt";
	label: string;
	prompt: string;
}

export interface DiscordModalActionPayload {
	type: "modal";
	label: string;
	title: string;
	inputLabel: string;
	prompt: string;
	placeholder?: string | undefined;
	required: boolean;
}

export interface DiscordSelectActionPayload {
	type: "select";
	options: Record<string, { label: string; prompt: string }>;
}

export type DiscordInteractionPayload =
	| DiscordPromptActionPayload
	| DiscordModalActionPayload
	| DiscordSelectActionPayload;
