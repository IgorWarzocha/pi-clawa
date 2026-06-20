export interface HerdrContext {
  mainPaneId: string
  workspaceId?: string
}

interface HerdrRect {
  x: number
  y: number
  width: number
  height: number
}

export interface HerdrLayoutPane {
  pane_id: string
  rect: HerdrRect
}

export function herdrBin(): string {
  return process.env.HERDR_BIN_PATH?.trim() || 'herdr'
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function parseHerdrResponse(stdout: string): Record<string, unknown> {
  const parsed = asRecord(JSON.parse(stdout))
  if (!parsed) {
    throw new Error('Herdr returned a non-object response')
  }
  const error = asRecord(parsed.error)
  if (error) {
    const message = typeof error.message === 'string' ? error.message : stdout
    throw new Error(message)
  }
  return parsed
}

export function parseHerdrPaneFromResponse(stdout: string): HerdrLayoutPane {
  const parsed = parseHerdrResponse(stdout)
  const result = asRecord(parsed.result)
  const pane = asRecord(result?.pane) ?? asRecord(result?.root_pane)
  const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : undefined
  if (!paneId) {
    throw new Error('Herdr response did not include a pane id')
  }
  return { pane_id: paneId, rect: { x: 0, y: 0, width: 0, height: 0 } }
}

export function parseHerdrLayoutPanes(stdout: string): HerdrLayoutPane[] {
  const parsed = parseHerdrResponse(stdout)
  const result = asRecord(parsed.result)
  const layout = asRecord(result?.layout)
  const panes = Array.isArray(layout?.panes) ? layout.panes : []
  return panes.flatMap((entry) => parseHerdrLayoutPane(entry) ?? [])
}

function parseHerdrLayoutPane(entry: unknown): HerdrLayoutPane | null {
  const pane = asRecord(entry)
  const rect = asRecord(pane?.rect)
  const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : undefined
  if (!(paneId && rect)) return null
  const herdrRect = parseHerdrRect(rect)
  return herdrRect ? { pane_id: paneId, rect: herdrRect } : null
}

function parseHerdrRect(rect: Record<string, unknown>): HerdrRect | null {
  const x = typeof rect.x === 'number' ? rect.x : undefined
  const y = typeof rect.y === 'number' ? rect.y : undefined
  const width = typeof rect.width === 'number' ? rect.width : undefined
  const height = typeof rect.height === 'number' ? rect.height : undefined
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null
  return { x, y, width, height }
}
