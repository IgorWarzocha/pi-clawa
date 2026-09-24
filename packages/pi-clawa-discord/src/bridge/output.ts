export interface DiscordOutputBlock {
  target: string
  content: string
}

const LINE_BREAK = /\r?\n/u

const MARKER_LINE = /^\[([^\]\r\n]+)\][ \t]*:?[ \t]*(.*)$/u
const ROUTE_HANDLE = /^(?:c|m[1-9]\d*)$/u

export function parseDiscordOutput(text: string): DiscordOutputBlock[] {
  const blocks: DiscordOutputBlock[] = []
  let current: { target: string; lines: string[] } | undefined

  const flush = () => {
    if (!current) return
    const content = current.lines.join('\n').trim()
    if (content) blocks.push({ target: current.target, content })
  }

  for (const line of text.split(LINE_BREAK)) {
    const match = line.match(MARKER_LINE)
    const target = match?.[1]?.trim()
    if (target && isRouteTarget(target)) {
      flush()
      current = { target, lines: [match?.[2] ?? ''] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

export async function processDiscordOutput(
  text: string,
  deliver: (block: DiscordOutputBlock, index: number) => Promise<void>,
): Promise<void> {
  for (const [index, block] of parseDiscordOutput(text).entries()) {
    await deliver(block, index)
  }
}

function isRouteTarget(target: string): boolean {
  return ROUTE_HANDLE.test(target)
}
