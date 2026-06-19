function squashWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

export function summarizePrompt(text: string): string {
  return truncate(squashWhitespace(text), 72)
}

export function summarizeAssistantText(text: string): string {
  return truncate(squashWhitespace(text), 96)
}

export function summarizeError(text: string): string {
  return truncate(squashWhitespace(text), 96)
}
