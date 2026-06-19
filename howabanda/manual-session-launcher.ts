import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BurrowDefaults } from '../config'
import type { WorkerDefinition } from './types.js'
import { getWorkerSocketAlias } from './worker-identity.js'

const execFileAsync = promisify(execFile)

interface LaunchOptions {
  definition: WorkerDefinition
  cwd: string
  extensionPaths: string[]
  burrowDefaults: BurrowDefaults
  reportSessionId?: string
  sessionFile?: string
}

interface TmuxContext {
  windowTarget: string
  mainPaneId: string
}

interface HerdrContext {
  mainPaneId: string
  workspaceId?: string
}

interface HerdrRect {
  x: number
  y: number
  width: number
  height: number
}

interface HerdrLayoutPane {
  pane_id: string
  rect: HerdrRect
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function buildInteractiveCommand(options: LaunchOptions, replaceShell = false): string {
  const args = ['pi']

  if (options.sessionFile?.trim()) {
    args.push('--session', options.sessionFile.trim())
  } else {
    args.push('-c')
  }

  for (const extensionPath of options.extensionPaths) {
    args.push('--extension', extensionPath)
  }
  if (options.definition.model) {
    args.push('--model', options.definition.model)
  }
  if (options.definition.thinking) {
    args.push('--thinking', options.definition.thinking)
  }

  const envVars: Record<string, string> = {
    PI_SKIP_VERSION_CHECK: '1',
    PI_HOWABANDA_CONTROL_SOCKET_DIR: options.burrowDefaults.controlSocketDir,
    PI_HOWABANDA_ROLE: 'worker',
    // Manual sessions intentionally advertise themselves as detached so the
    // banda tools refuse to steer/read them until the human closes the session.
    PI_HOWABANDA_MANUAL_SESSION: '1',
    PI_HOWABANDA_WORKER_ID: options.definition.id,
    PI_HOWABANDA_WORKER_TITLE: options.definition.title,
    PI_HOWABANDA_SOCKET_ALIAS: getWorkerSocketAlias(options.definition),
  }
  if (options.reportSessionId) {
    envVars.PI_HOWABANDA_REPORT_SESSION_ID = options.reportSessionId
  }
  if (process.env.PI_HOWABANDA_CONTROL_SOCKET_ROOT) {
    envVars.PI_HOWABANDA_CONTROL_SOCKET_ROOT = process.env.PI_HOWABANDA_CONTROL_SOCKET_ROOT
  }
  if (process.env.PI_CLAW_PROJECT_ROOT) {
    envVars.PI_CLAW_PROJECT_ROOT = process.env.PI_CLAW_PROJECT_ROOT
    envVars.PI_CWD = process.env.PI_CLAW_PROJECT_ROOT
  }

  const envPrefix = Object.entries(envVars)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(' ')
  const argString = args.map(shellEscape).join(' ')
  return `${envPrefix} ${replaceShell ? 'exec ' : ''}${argString}`
}

function sanitizeWindowName(value: string, fallback: string): string {
  return value.replaceAll(/[^A-Za-z0-9:_-]+/g, '-').slice(0, 40) || fallback
}

function herdrBin(): string {
  return process.env.HERDR_BIN_PATH?.trim() || 'herdr'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseHerdrResponse(stdout: string): Record<string, unknown> {
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

function parseHerdrPaneFromResponse(stdout: string): HerdrLayoutPane {
  const parsed = parseHerdrResponse(stdout)
  const result = asRecord(parsed.result)
  const pane = asRecord(result?.pane) ?? asRecord(result?.root_pane)
  const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : undefined
  if (!paneId) {
    throw new Error('Herdr response did not include a pane id')
  }
  return { pane_id: paneId, rect: { x: 0, y: 0, width: 0, height: 0 } }
}

function parseHerdrLayoutPanes(stdout: string): HerdrLayoutPane[] {
  const parsed = parseHerdrResponse(stdout)
  const result = asRecord(parsed.result)
  const layout = asRecord(result?.layout)
  const panes = Array.isArray(layout?.panes) ? layout.panes : []
  return panes.flatMap((entry) => {
    const pane = asRecord(entry)
    const rect = asRecord(pane?.rect)
    const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : undefined
    if (!(paneId && rect)) return []
    const x = typeof rect.x === 'number' ? rect.x : undefined
    const y = typeof rect.y === 'number' ? rect.y : undefined
    const width = typeof rect.width === 'number' ? rect.width : undefined
    const height = typeof rect.height === 'number' ? rect.height : undefined
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return []
    }
    return [{ pane_id: paneId, rect: { x, y, width, height } }]
  })
}

/**
 * Opens worker sessions for direct human takeover.
 * Herdr is preferred when the main session is running in Herdr; tmux remains as
 * a fallback for older server sessions.
 */
export class HowabandaManualSessionLauncher {
  private tmuxContext: TmuxContext | null = null
  private herdrContext: HerdrContext | null = null

  async captureCurrentHostPane(): Promise<void> {
    this.tmuxContext = null
    this.herdrContext = null

    if (process.env.HERDR_ENV === '1' && process.env.HERDR_PANE_ID?.trim()) {
      await this.captureCurrentHerdrPane()
      if (this.herdrContext) {
        return
      }
    }

    await this.captureCurrentTmuxPane()
  }

  async captureCurrentTmuxPane(): Promise<void> {
    if (!process.env.TMUX) {
      this.tmuxContext = null
      return
    }

    const result = await execFileAsync('tmux', ['display-message', '-p', '#S:#I\n#{pane_id}'])
    const [windowTarget, mainPaneId] = result.stdout.trim().split('\n')
    if (!(windowTarget && mainPaneId)) {
      this.tmuxContext = null
      return
    }

    this.tmuxContext = { windowTarget, mainPaneId }
  }

  async captureCurrentHerdrPane(): Promise<void> {
    const mainPaneId = process.env.HERDR_PANE_ID?.trim()
    if (!mainPaneId) {
      this.herdrContext = null
      return
    }

    try {
      const result = await execFileAsync(herdrBin(), ['pane', 'current', '--pane', mainPaneId])
      const parsed = parseHerdrResponse(result.stdout)
      const pane = asRecord(asRecord(parsed.result)?.pane)
      const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : mainPaneId
      const workspaceId =
        typeof pane?.workspace_id === 'string'
          ? pane.workspace_id
          : process.env.HERDR_WORKSPACE_ID?.trim() || undefined
      this.herdrContext = { mainPaneId: paneId, workspaceId }
    } catch {
      this.herdrContext = null
    }
  }

  canOpenPanel(): boolean {
    return !!this.herdrContext || !!this.tmuxContext
  }

  getHostLabel(): string | null {
    if (this.herdrContext) return 'Herdr'
    if (this.tmuxContext) return 'tmux'
    return null
  }

  async openPanel(options: LaunchOptions): Promise<string> {
    if (this.herdrContext) {
      return await this.openHerdrPanel(this.herdrContext, options)
    }
    if (this.tmuxContext) {
      return await this.openTmuxPanel(this.tmuxContext, options)
    }
    throw new Error(
      `${options.burrowDefaults.bandaName} manual takeover requires Herdr or tmux; open the main session inside one first`,
    )
  }

  async openWindow(options: LaunchOptions): Promise<string> {
    if (this.herdrContext) {
      return await this.openHerdrTab(this.herdrContext, options)
    }
    if (this.tmuxContext) {
      return await this.openTmuxWindow(this.tmuxContext, options)
    }
    throw new Error(
      `${options.burrowDefaults.bandaName} manual window mode requires Herdr or tmux; open the main session inside one first`,
    )
  }

  private async openHerdrPanel(context: HerdrContext, options: LaunchOptions): Promise<string> {
    const command = buildInteractiveCommand(options, true)
    const targetPane = await this.findLastRightHandHerdrPane(context)
    const splitArgs = targetPane
      ? [
          'pane',
          'split',
          '--pane',
          targetPane,
          '--direction',
          'down',
          '--cwd',
          options.cwd,
          '--focus',
        ]
      : [
          'pane',
          'split',
          '--pane',
          context.mainPaneId,
          '--direction',
          'right',
          '--ratio',
          '0.6',
          '--cwd',
          options.cwd,
          '--focus',
        ]
    const result = await execFileAsync(herdrBin(), splitArgs, {
      cwd: options.cwd,
    })
    const newPaneId = parseHerdrPaneFromResponse(result.stdout).pane_id

    await this.renameHerdrPane(newPaneId, options.definition.title)
    await execFileAsync(herdrBin(), ['pane', 'run', newPaneId, command], {
      cwd: options.cwd,
    })
    return newPaneId
  }

  private async openHerdrTab(context: HerdrContext, options: LaunchOptions): Promise<string> {
    const fallbackName = sanitizeWindowName(
      options.burrowDefaults.bandaName.toLowerCase(),
      'burrow',
    )
    const tabName = sanitizeWindowName(options.definition.title, fallbackName)
    const args = ['tab', 'create', '--cwd', options.cwd, '--label', tabName, '--focus']
    if (context.workspaceId) {
      args.splice(2, 0, '--workspace', context.workspaceId)
    }

    const result = await execFileAsync(herdrBin(), args, { cwd: options.cwd })
    const rootPaneId = parseHerdrPaneFromResponse(result.stdout).pane_id
    await execFileAsync(
      herdrBin(),
      ['pane', 'run', rootPaneId, buildInteractiveCommand(options, true)],
      { cwd: options.cwd },
    )
    return rootPaneId
  }

  private async renameHerdrPane(paneId: string, label: string): Promise<void> {
    try {
      await execFileAsync(herdrBin(), ['pane', 'rename', paneId, label])
    } catch {
      // Cosmetic only. Older Herdr builds may not support pane labels the same way.
    }
  }

  private async openTmuxPanel(context: TmuxContext, options: LaunchOptions): Promise<string> {
    const command = buildInteractiveCommand(options)
    const targetPane = await this.findLastRightHandTmuxPane(context)
    const splitArgs = targetPane
      ? [
          'split-window',
          '-v',
          '-c',
          options.cwd,
          '-P',
          '-F',
          '#{pane_id}',
          '-t',
          targetPane,
          command,
        ]
      : [
          'split-window',
          '-h',
          '-c',
          options.cwd,
          '-P',
          '-F',
          '#{pane_id}',
          '-t',
          context.mainPaneId,
          command,
        ]
    const result = await execFileAsync('tmux', splitArgs, { cwd: options.cwd })
    const newPaneId = result.stdout.trim()

    await execFileAsync('tmux', ['select-pane', '-t', context.mainPaneId])
    await execFileAsync('tmux', [
      'set-window-option',
      '-t',
      context.windowTarget,
      'main-pane-width',
      '60%',
    ])
    await execFileAsync('tmux', ['select-layout', '-t', context.windowTarget, 'main-vertical'])
    await execFileAsync('tmux', ['select-pane', '-t', newPaneId])
    return newPaneId
  }

  private async openTmuxWindow(_context: TmuxContext, options: LaunchOptions): Promise<string> {
    const fallbackName = sanitizeWindowName(
      options.burrowDefaults.bandaName.toLowerCase(),
      'burrow',
    )
    const windowName = sanitizeWindowName(options.definition.title, fallbackName)
    const command = buildInteractiveCommand(options)
    const result = await execFileAsync(
      'tmux',
      ['new-window', '-c', options.cwd, '-P', '-F', '#{window_id}', '-n', windowName, command],
      { cwd: options.cwd },
    )
    return result.stdout.trim()
  }

  private async findLastRightHandTmuxPane(context: TmuxContext): Promise<string | null> {
    const result = await execFileAsync('tmux', [
      'list-panes',
      '-t',
      context.windowTarget,
      '-F',
      '#{pane_id} #{pane_left} #{pane_top}',
    ])
    const rightHandPanes = result.stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [paneId, left, top] = line.split(/\s+/)
        return {
          paneId,
          left: Number(left),
          top: Number(top),
        }
      })
      .filter((pane) => pane.left > 0)
      .sort((left, right) => left.top - right.top)

    return rightHandPanes.at(-1)?.paneId ?? null
  }

  private async findLastRightHandHerdrPane(context: HerdrContext): Promise<string | null> {
    try {
      const result = await execFileAsync(herdrBin(), [
        'pane',
        'layout',
        '--pane',
        context.mainPaneId,
      ])
      const panes = parseHerdrLayoutPanes(result.stdout)
      const mainPane = panes.find((pane) => pane.pane_id === context.mainPaneId)
      if (!mainPane) {
        return null
      }

      const rightHandPanes = panes
        .filter((pane) => pane.pane_id !== context.mainPaneId && pane.rect.x > mainPane.rect.x)
        .sort((left, right) => left.rect.y - right.rect.y || left.rect.x - right.rect.x)

      return rightHandPanes.at(-1)?.pane_id ?? null
    } catch {
      return null
    }
  }
}
