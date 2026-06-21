const DANGEROUS_INVISIBLE_CHARS = /[\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const CONTROL_CHARS_EXCEPT_TAB_NEWLINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu;
const LINE_BREAKS = /\r\n?|[\u2028\u2029]/gu;
const DISPLAY_NAME_WHITESPACE = /\s+/gu;

export function sanitizeDiscordText(input: string): string {
  return input
    .normalize('NFC')
    .replace(LINE_BREAKS, '\n')
    .replace(DANGEROUS_INVISIBLE_CHARS, '')
    .replace(CONTROL_CHARS_EXCEPT_TAB_NEWLINE, '');
}

export function sanitizeDiscordLabel(input: string): string {
  return sanitizeDiscordText(input).replace(DISPLAY_NAME_WHITESPACE, ' ').trim();
}
