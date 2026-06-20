import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { Align, Line, Primitive, Slot, Theme, Tone } from './types.js'
import { FRAME_ROWS } from './types.js'

function coloredLine(line: Line, theme: Theme): string {
  let out = ''
  for (const cell of line.cells) {
    if (cell.tone === 'dim') out += theme.fg('dim', cell.text)
    else if (cell.tone === 'accent') out += theme.fg('accent', cell.text)
    else out += cell.text
  }
  return out
}

export function row(text: string, tone: Tone = 'normal'): Line {
  return { cells: [{ text, tone }] }
}

function cut(value: string, width: number): string {
  return truncateToWidth(value, Math.max(0, width))
}
function blank(width: number): string {
  return ' '.repeat(Math.max(0, width))
}
function sep(width: number, theme: Theme): string {
  return cut(theme.fg('accent', '─'.repeat(Math.max(0, width))), width)
}
function foot(slot: Slot): string {
  if (slot.tier === 'top') {
    if (!slot.shortcuts) return 'shift+h help • ? about • esc close'
    return `${slot.shortcuts} • shift+h help • ? about • esc close`
  }
  if (!slot.shortcuts) return 'esc back'
  return `${slot.shortcuts} • esc back`
}
export function create(
  slot: Slot,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  return {
    render(width: number): string[] {
      const out: string[] = []
      const bodyRows = Math.max(0, FRAME_ROWS - 8)
      const rows = slot.content.slice(0, bodyRows)
      out.push(
        sep(width, theme),
        blank(width),
        cut(theme.fg('accent', slot.title), width),
        blank(width),
      )
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i]
        if (!line) continue
        const value = coloredLine(line, theme)
        out.push(cut(slot.active.includes(i) ? theme.fg('accent', value) : value, width))
      }
      for (let i = 0; i < Math.max(0, FRAME_ROWS - (8 + rows.length)); i++) out.push(blank(width))
      out.push(
        blank(width),
        cut(` ${theme.fg('dim', foot(slot))}`, width),
        blank(width),
        sep(width, theme),
      )
      return out.slice(0, FRAME_ROWS)
    },
    invalidate() {},
  }
}

function pad(value: string, width: number): string {
  const cropped = truncateToWidth(value, width)
  return cropped + ' '.repeat(Math.max(0, width - visibleWidth(cropped)))
}
function detailTitlebar(title: string, inner: number, theme: Theme): string {
  const plain = ` ${title} `
  const size = Math.max(0, inner - plain.length)
  const left = Math.floor(size / 2)
  const right = Math.max(0, size - left)
  return pad(
    theme.fg('borderMuted', '─'.repeat(left)) +
      theme.fg('accent', plain) +
      theme.fg('borderMuted', '─'.repeat(right)),
    inner,
  )
}
function frame(lines: string[], width: number, title: string, theme: Theme): string[] {
  const inner = Math.max(4, width - 4)
  const border = (v: string) => theme.fg('borderMuted', v)
  const out = [
    border(`┌${'─'.repeat(inner)}┐`),
    border('│') + detailTitlebar(title, inner, theme) + border('│'),
    border('│') + ' '.repeat(inner) + border('│'),
  ]
  for (const line of lines) out.push(border('│') + pad(line, inner) + border('│'))
  out.push(border(`└${'─'.repeat(inner)}┘`))
  return out
}
export function renderDetail(slot: Slot, width: number, bottom: number, theme: Theme): string[] {
  const body = slot.content.map((line) => coloredLine(line, theme))
  const take = Math.max(1, bottom * 2 - 4)
  return frame(body.slice(0, take), width, slot.title, theme)
}

export function staticPrimitive(slot: () => Slot): Primitive {
  return {
    slot,
    up: () => {},
    down: () => {},
    search: () => false,
    set: (_query: string) => {},
    enter: () => undefined,
    hasView: () => false,
    view: () => undefined,
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
export function padCell(value: string, width: number, align: Align): string {
  const valueText = value.length > width ? value.slice(0, Math.max(0, width)) : value
  const size = Math.max(0, width - valueText.length)
  return align === 'right' ? ' '.repeat(size) + valueText : valueText + ' '.repeat(size)
}
