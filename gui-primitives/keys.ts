import { matchesKey } from '@earendil-works/pi-tui'

export function esc(data: string): boolean {
  return matchesKey(data, 'escape')
}
export function tab(data: string): boolean {
  return matchesKey(data, 'tab')
}
export function backtab(data: string): boolean {
  return matchesKey(data, 'shift+tab')
}
export function enter(data: string): boolean {
  return matchesKey(data, 'enter')
}
export function down(data: string): boolean {
  return matchesKey(data, 'down') || matchesKey(data, 'j')
}
export function up(data: string): boolean {
  return matchesKey(data, 'up') || matchesKey(data, 'k')
}
export function slash(data: string): boolean {
  return data === '/'
}
export function about(data: string): boolean {
  return data === '?'
}
export function help(data: string): boolean {
  return data === 'H'
}
export function back(data: string): boolean {
  return matchesKey(data, 'backspace')
}
export function text(data: string): boolean {
  return data.length === 1 && data >= ' ' && data <= '~'
}
export function detailToggle(data: string): boolean {
  return data === 'v' || data === 'V'
}
export function detailScroll(data: string): number {
  if (data === 'J') return 1
  if (data === 'K') return -1
  return 0
}
