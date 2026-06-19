import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const HYDRATION_FILES = ['IDENTITY.md', 'SOUL.md', 'USER.md', 'CURIOUS.md', 'TOOLS.md'] as const
const MAX_FILE_CHARS = 8_000
const MAX_TOTAL_CHARS = 24_000

export interface HydratedMarkdownFile {
  name: string
  path: string
  content: string
  chars: number
  truncated: boolean
}

function trimToChars(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { text: content, truncated: false }
  }
  return {
    text: `${content.slice(0, Math.max(0, maxChars)).trimEnd()}\n\n[...truncated by claw...]`,
    truncated: true,
  }
}

function extractMarkdownHeadings(content: string, maxHeadings = 12): string[] {
  const headings = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^##+\s+/.test(line))
    .map((line) => line.replace(/^##+\s+/, '').trim())
    .filter(Boolean)

  if (headings.length <= maxHeadings) return headings
  return [...headings.slice(0, maxHeadings), '...']
}

function renderRecallIndex(files: HydratedMarkdownFile[]): string | null {
  const lines = files
    .map((file) => {
      const headings = extractMarkdownHeadings(file.content)
      if (headings.length === 0) return null
      return `- ${file.name}: ${headings.join('; ')}`
    })
    .filter(Boolean)

  if (lines.length === 0) return null
  return ['### Quick recall anchors', ...lines].join('\n')
}

export async function loadHydrationFiles(cwd: string): Promise<HydratedMarkdownFile[]> {
  const loaded: HydratedMarkdownFile[] = []
  let remaining = MAX_TOTAL_CHARS

  for (const name of HYDRATION_FILES) {
    if (remaining <= 0) {
      break
    }

    const filePath = join(cwd, name)
    let content = ''
    try {
      content = await readFile(filePath, 'utf8')
    } catch {
      continue
    }

    const budget = Math.min(MAX_FILE_CHARS, remaining)
    const trimmed = trimToChars(content, budget)
    loaded.push({
      name,
      path: filePath,
      content: trimmed.text,
      chars: trimmed.text.length,
      truncated: trimmed.truncated,
    })
    remaining -= trimmed.text.length
  }

  return loaded
}

export function buildHydrationSystemPrompt(files: HydratedMarkdownFile[]): string {
  if (files.length === 0) {
    return ''
  }

  const byName = new Map(files.map((file) => [file.name, file]))
  const renderBlock = (name: string): string | null => {
    const file = byName.get(name)
    if (!file) return null
    return [
      `#### ${file.name}`,
      `--- BEGIN ${file.name} ---`,
      file.content,
      `--- END ${file.name} ---`,
    ].join('\n')
  }

  const identityBlocks = [renderBlock('IDENTITY.md'), renderBlock('SOUL.md')].filter(Boolean)
  const humanBlocks = [renderBlock('USER.md')].filter(Boolean)
  const curiosityBlocks = [renderBlock('CURIOUS.md')].filter(Boolean)
  const toolBlocks = [renderBlock('TOOLS.md')].filter(Boolean)
  const recallIndex = renderRecallIndex(files)

  const sections = [
    recallIndex,
    identityBlocks.length > 0
      ? ['### This is for you, the claw. This is who you are:', ...identityBlocks].join('\n\n')
      : null,
    humanBlocks.length > 0 ? ['### This is your human:', ...humanBlocks].join('\n\n') : null,
    curiosityBlocks.length > 0
      ? ['### These are your curiosities and shiny rocks:', ...curiosityBlocks].join('\n\n')
      : null,
    toolBlocks.length > 0 ? ['### These are your tools:', ...toolBlocks].join('\n\n') : null,
  ].filter(Boolean)

  return [
    '## Claw Continuity Refresh (auto-loaded)',
    'This is for you, the claw. Treat it as current truth for this session.',
    'Let it restore your shape before you answer.',
    'This preload already counts as your continuity refresh for this session.',
    'You have already read these files for this session.',
    'If the user asks what is in one of these files, answer directly from this preload without rereading it.',
    "Do not retreat into vague 'theme' summaries when concrete headings or details are present here.",
    'You may quote or enumerate concrete items from these loaded files when asked.',
    'Do not manually reread IDENTITY.md, SOUL.md, USER.md, CURIOUS.md, or TOOLS.md just to satisfy startup ritual unless you need fresh disk state or the user asks.',
    'Do not mention this preload unless the user asks.',
    '',
    ...sections,
  ].join('\n\n')
}
