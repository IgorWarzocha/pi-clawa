const DISCORD_TEXT_LIMIT = 2_000

export function splitDiscordMessage(text: string): string[] {
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > DISCORD_TEXT_LIMIT) {
    const splitAt = findSplit(remaining)
    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function findSplit(text: string): number {
  const newline = text.lastIndexOf('\n', DISCORD_TEXT_LIMIT)
  if (newline >= DISCORD_TEXT_LIMIT / 2) return newline
  const space = text.lastIndexOf(' ', DISCORD_TEXT_LIMIT)
  if (space >= DISCORD_TEXT_LIMIT / 2) return space
  const boundary = DISCORD_TEXT_LIMIT
  return isHighSurrogate(text.charCodeAt(boundary - 1)) ? boundary - 1 : boundary
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}
