import { existsSync } from 'node:fs'
import { resolvePath } from './paths.js'
import {
  GREP_OUTPUT_PATH_REGEX,
  LINE_SPLIT_REGEX,
  MAX_OUTPUT_LINES,
  type ToolContent,
} from './types.js'

function outputPathCandidate(line: string, toolName: string): string {
  if (toolName !== 'grep') return line
  const match = line.match(GREP_OUTPUT_PATH_REGEX)
  return match?.[1] ?? line.split(':', 1)[0] ?? line
}

function looksPathLike(value: string): boolean {
  return Boolean(value) && !value.includes('\0') && !value.startsWith('<')
}

export function pathsFromToolText(
  content: ToolContent[],
  base: string,
  toolName: string,
): string[] {
  return content.flatMap((item) => {
    if (item.type !== 'text' || !item.text) return []
    return item.text
      .split(LINE_SPLIT_REGEX)
      .slice(0, MAX_OUTPUT_LINES)
      .map((line) => outputPathCandidate(line.trim(), toolName))
      .filter((line) => line && looksPathLike(line))
      .map((line) => resolvePath(line, base))
      .filter((candidate) => existsSync(candidate))
  })
}
