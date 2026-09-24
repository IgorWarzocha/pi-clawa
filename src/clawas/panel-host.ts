export type PanelHandle =
  | {
      host: 'herdr'
      paneId: string
      tabId: string
      terminalId: string
      agentName: string
      sessionFile: string
      session: string
    }
  | {
      host: 'tmux'
      paneId: string
      panePid: string
      socket: string
      serverPid: string
      sessionFile: string
    }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parsePanelHandle(value: unknown): PanelHandle {
  const data = record(value)
  if (!data) throw new Error('Invalid Clawas panel handle')
  if (
    data['host'] === 'herdr' &&
    ['paneId', 'tabId', 'terminalId', 'agentName', 'sessionFile', 'session'].every(
      (key) => typeof data[key] === 'string' && (data[key] as string).length > 0,
    )
  ) {
    return data as PanelHandle
  }
  if (
    data['host'] === 'tmux' &&
    ['paneId', 'panePid', 'socket', 'serverPid', 'sessionFile'].every(
      (key) => typeof data[key] === 'string' && (data[key] as string).length > 0,
    )
  ) {
    return data as PanelHandle
  }
  throw new Error('Invalid Clawas panel handle')
}

export function herdrResult(stdout: string): Record<string, unknown> {
  const response = record(JSON.parse(stdout))
  if (!response) throw new Error('Herdr returned a non-object response')
  const error = record(response['error'])
  if (error) throw new HerdrResponseError(String(error['message'] ?? stdout), error['code'])
  const result = record(response['result'])
  if (!result) throw new Error('Herdr returned no result')
  return result
}

export class HerdrResponseError extends Error {
  readonly code: unknown

  constructor(message: string, code: unknown) {
    super(message)
    this.code = code
  }
}

export function herdrObject(value: unknown, label: string): Record<string, unknown> {
  const object = record(value)
  if (!object) throw new Error(`Herdr returned no ${label}`)
  return object
}

export function herdrId(value: Record<string, unknown>, key: string): string {
  const id = value[key]
  if (typeof id !== 'string' || !id) throw new Error(`Herdr returned no ${key}`)
  return id
}
