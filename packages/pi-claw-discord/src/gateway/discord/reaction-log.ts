export function buildReactionLogContent(opts: {
  action: 'added' | 'removed';
  emoji: string;
  targetAuthor: string;
  messageContent: string;
}): string {
  const verb = opts.action === 'added' ? 'reacted with' : 'removed';
  const snippet = buildMessageSnippet(opts.messageContent);

  if (opts.action === 'added') {
    return `reacted with ${opts.emoji} to ${opts.targetAuthor}'s message: ${snippet}`;
  }

  return `removed ${opts.emoji} reaction from ${opts.targetAuthor}'s message: ${snippet}`;
}

function buildMessageSnippet(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '"(attachment-only or empty message)"';
  }

  const collapsed = trimmed.replace(/\s+/g, ' ');
  const snippet = collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
  return `"${snippet}"`;
}
